package dev.monocalendar.rp1;

import java.util.*;

/**
 * Home Assistant writes the panel has asked for, kept apart from what HA has confirmed.
 *
 * `data` (the latest /data) is always HA's confirmed state. This table holds one request per control:
 * the requested target and where it stands — sending, pending (server checking within its budget),
 * unconfirmed (budget spent, still being re-checked). The screen draws HA's value with an overlay:
 * a waiting write shows its target with a waiting mark; an unconfirmed one shows HA's value marked
 * 未确认. Confirmed, superseded and failed requests simply drop out, so nothing is ever "rolled back".
 * Times are a monotonic clock (elapsedRealtime), never the wall clock, which the RP1 may have wrong.
 */
public final class Requests {
    public static final long FAST_MS = 1000, RECHECK_MS = 5000, BUDGET_MS = 10000, GIVE_UP_MS = 130000;
    // The server allows screen checks 390 s; leave another 10 s to read the result.
    private static final long SCREEN_GIVE_UP_MS = 400000;
    public static final String SENDING = "sending", PENDING = "pending", UNCONFIRMED = "unconfirmed";

    public static final class Request {
        public final String requestId, key, action;
        public final long startedAt;
        public long sequence;
        public String serverId, status = SENDING;
        Request(String requestId, String key, String action, long startedAt) {
            this.requestId = requestId;
            this.key = key;
            this.action = action;
            this.startedAt = startedAt;
        }
    }
    private final Map<String, Request> byKey = new LinkedHashMap<>();

    /** One control, one key: a newer request for the same control replaces the older one. */
    public static String keyOf(String action) {
        if (action.startsWith("device:")) {
            String[] actionParts = action.split(":");
            return actionParts.length > 1 ? "device:" + actionParts[1] : action;
        }
        return "assistant".equals(action) ? action : "climate";
    }
    public Request get(String key) {
        return byKey.get(key);
    }
    public boolean any() {
        return !byKey.isEmpty();
    }

    /** Starts a request, or returns null when the same target is already on its way. */
    public Request start(String action, String requestId, long now) {
        String key = keyOf(action);
        Request existingRequest = byKey.get(key);
        if (existingRequest != null && existingRequest.action.equals(action)
            && !UNCONFIRMED.equals(existingRequest.status))
            return null;
        Request request = new Request(requestId, key, action, now);
        byKey.put(key, request);
        return request;
    }
    private Request findById(String requestId) {
        for (Request request : byKey.values())
            if (request.requestId.equals(requestId))
                return request;
        return null;
    }
    /** POST /action answered 202. */
    public void accepted(String requestId, long sequence, String serverId, String status) {
        Request request = findById(requestId);
        if (request == null)
            return;
        request.sequence = sequence;
        request.serverId = serverId;
        if (PENDING.equals(status) || UNCONFIRMED.equals(status))
            request.status = status;
        else if (status != null && !SENDING.equals(status))
            byKey.remove(request.key); // already confirmed / failed
    }
    /** The request never left the panel (or the server refused it): nothing to wait for. */
    public void notSent(String requestId) {
        Request request = findById(requestId);
        if (request != null)
            byKey.remove(request.key);
    }
    /** The reply was lost after the request went out: it may have been applied, so keep checking by id. */
    public void replyLost(String requestId) {
        Request request = findById(requestId);
        if (request != null)
            request.status = UNCONFIRMED;
    }

    /** Folds a /data document in. Returns failure reasons and completed screen-check feedback. */
    public List<String> reconcile(Object data, long now) {
        List<String> notices = new ArrayList<>();
        String serverId = Json.str(data, "server");
        Double latestSequence = Json.num(data, "actionSeq");
        Map<String, Object> requestsById = new HashMap<>();
        for (Object replyEntry : Json.list(data, "requests")) {
            String requestId = Json.str(replyEntry, "id");
            if (requestId != null)
                requestsById.put(requestId, replyEntry);
        }
        for (Iterator<Request> requestIterator = byKey.values().iterator(); requestIterator.hasNext();) {
            Request request = requestIterator.next();
            Object entry = requestsById.get(request.requestId);
            if (entry != null) {
                String requestStatus = Json.str(entry, "status");
                if (PENDING.equals(requestStatus) || UNCONFIRMED.equals(requestStatus)) {
                    request.status = requestStatus;
                } else {
                    requestIterator.remove();
                    if ("failed".equals(requestStatus)) {
                        String errorMessage = Json.str(entry, "error");
                        notices.add(errorMessage == null ? "操作未执行" : errorMessage);
                    } else if ("confirmed".equals(requestStatus) && "assistant".equals(request.key)) {
                        String message = Json.str(entry, "message");
                        if (message != null && !message.isEmpty())
                            notices.add(message);
                    }
                    continue;
                }
            } else if (request.sequence > 0 && serverId != null && request.serverId != null
                && !serverId.equals(request.serverId)) {
                requestIterator.remove();
                notices.add("服务已重启，请核对设备状态");
                continue; // the server lost its record
            } else if (request.sequence > 0 && latestSequence != null && latestSequence >= request.sequence
                && serverId != null && serverId.equals(request.serverId)) {
                requestIterator.remove();
                continue; // the record aged out; this document already reflects HA after it
            }
            // Otherwise this document predates the request (or the 202 has not arrived yet): keep waiting.
            if (now - request.startedAt > ("assistant".equals(request.key) ? SCREEN_GIVE_UP_MS : GIVE_UP_MS)) {
                requestIterator.remove();
                notices.add("操作未确认，请核对设备状态");
            }
        }
        return notices;
    }

    /** Delay before the next read-back: 1 s while a write is inside its budget, then 5 s; -1 when none. */
    public long nextRead(long now) {
        long next = -1;
        for (Request request : byKey.values()) {
            long delay = !UNCONFIRMED.equals(request.status) && now - request.startedAt < BUDGET_MS + 2000 ? FAST_MS
                                                                                                           : RECHECK_MS;
            next = next < 0 ? delay : Math.min(next, delay);
        }
        return next;
    }
    /** True when a climate mode change is still waiting: a temperature tap must not race it. */
    public boolean modeChanging() {
        Request request = byKey.get("climate");
        return request != null && request.action.startsWith("mode:") && !UNCONFIRMED.equals(request.status);
    }

    /** HA's data with waiting targets drawn in and every outstanding request marked under "pending". */
    @SuppressWarnings("unchecked")
    public Object overlay(Object data) {
        if (byKey.isEmpty() || !(data instanceof Map))
            return data;
        Map<String, Object> overlayData = (Map<String, Object>) Json.copy(data);
        Map<String, Object> pendingMarks = new LinkedHashMap<>();
        for (Request request : byKey.values()) {
            boolean waiting = !UNCONFIRMED.equals(request.status);
            if (waiting)
                Optimistic.apply(overlayData, request.action);
            pendingMarks.put(request.key, waiting ? "wait" : "unconfirmed");
        }
        overlayData.put("pending", pendingMarks);
        return overlayData;
    }
}
