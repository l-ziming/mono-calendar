import dev.monocalendar.rp1.*;
import java.util.*;

/** The App's request table: HA's data stays authoritative, requests only add marks (run with -ea). */
public class RequestsCheck {
    static Object doc(String devices, String requests, long seq, String server) {
        return Json.parse("{\"dataTime\":1,\"server\":\"" + server + "\",\"actionSeq\":" + seq + ",\"devices\":["
            + devices + "],\"requests\":[" + requests + "],"
            + "\"ac\":{\"mode\":\"heat\",\"target\":16.0,\"low\":16.0,\"high\":24.0}}");
    }
    public static void main(String[] args) {
        Requests requests = new Requests();
        long startedAt = 1000;
        Object confirmedData = doc("{\"id\":\"desk_light\",\"on\":false}", "", 3, "s1");
        assert requests.overlay(confirmedData) == confirmedData : "no requests: the screen is exactly HA's data";

        Requests.Request light = requests.start("device:desk_light:on", "id-1", startedAt);
        assert light != null;
        assert requests.start("device:desk_light:on", "id-1b", startedAt)
            == null : "a repeated tap with the same target sends nothing";
        Object shown = requests.overlay(confirmedData);
        assert Json.bool(Json.list(shown, "devices").get(0), "on")
            && "wait".equals(Json.str(Json.obj(shown, "pending"), "device:desk_light"));
        assert !Json.bool(Json.list(confirmedData, "devices").get(0), "on")
            : "the overlay is a copy; HA's data is untouched";
        assert requests.nextRead(startedAt) == Requests.FAST_MS;

        // A document from before the 202 (or before the request) changes nothing.
        requests.reconcile(confirmedData, startedAt + 200);
        assert requests.get("device:desk_light") != null;
        requests.accepted("id-1", 4, "s1", "pending");
        requests.reconcile(doc("{\"id\":\"desk_light\",\"on\":false}", "", 3, "s1"), startedAt + 400);
        assert requests.get("device:desk_light") != null : "a document older than the request cannot settle it";

        // Budget spent: HA's value is shown again, marked unconfirmed, checked every 5 s.
        requests.reconcile(doc("{\"id\":\"desk_light\",\"on\":false}",
                               "{\"id\":\"id-1\",\"key\":\"device:desk_light\",\"status\":\"unconfirmed\"}", 4, "s1"),
            startedAt + 11000);
        shown = requests.overlay(doc("{\"id\":\"desk_light\",\"on\":false}", "", 4, "s1"));
        assert !Json.bool(Json.list(shown, "devices").get(0), "on") : "unconfirmed never displays the target as fact";
        assert "unconfirmed".equals(Json.str(Json.obj(shown, "pending"), "device:desk_light"));
        assert requests.nextRead(startedAt + 11000) == Requests.RECHECK_MS;
        assert requests.start("device:desk_light:on", "id-2", startedAt + 11500)
            != null : "an unconfirmed target may be asked for again";
        requests.accepted("id-2", 5, "s1", "pending");

        // Confirmed: the request drops out and HA's (now on) state is simply what is drawn.
        List<String> notices =
            requests.reconcile(doc("{\"id\":\"desk_light\",\"on\":true}",
                                   "{\"id\":\"id-2\",\"key\":\"device:desk_light\",\"status\":\"confirmed\"}", 5, "s1"),
                startedAt + 12000);
        assert notices.isEmpty() && !requests.any() && requests.nextRead(startedAt + 12000) == -1;

        // Failed: dropped with the server's reason; nothing is rolled back because nothing was changed.
        requests.start("device:bedroom_light:on", "id-3", startedAt);
        requests.accepted("id-3", 6, "s1", "pending");
        assert "wait".equals(Json.str(Json.obj(requests.overlay(confirmedData), "pending"), "device:bedroom_light"));
        notices = requests.reconcile(
            doc("",
                "{\"id\":\"id-3\",\"key\":\"device:bedroom_light\",\"status\":\"failed\",\"error\":\"设备拒绝了该操作\"}",
                6, "s1"),
            startedAt + 2000);
        assert notices.equals(Collections.singletonList("设备拒绝了该操作")) && !requests.any();

        // Server restarted (different boot id): its record is gone, the request ends with a notice.
        requests.start("device:fan:on", "id-4", startedAt);
        requests.accepted("id-4", 7, "s1", "pending");
        notices = requests.reconcile(doc("", "", 1, "s2"), startedAt + 3000);
        assert !requests.any() && notices.size() == 1;
        // Record aged out but the server has moved past it: settled, no notice.
        requests.start("device:fan:off", "id-5", startedAt);
        requests.accepted("id-5", 8, "s1", "pending");
        notices = requests.reconcile(doc("", "", 9, "s1"), startedAt + 3000);
        assert !requests.any() && notices.isEmpty();
        // POST never reached the server: no mark at all. Reply lost after sending: keep checking by id.
        requests.start("device:fan:on", "id-6", startedAt);
        requests.notSent("id-6");
        assert !requests.any();
        requests.start("device:fan:on", "id-7", startedAt);
        requests.replyLost("id-7");
        assert "unconfirmed".equals(Json.str(Json.obj(requests.overlay(confirmedData), "pending"), "device:fan"));
        notices = requests.reconcile(confirmedData, startedAt + Requests.GIVE_UP_MS + 1);
        assert !requests.any() && notices.size() == 1 : "nothing waits forever";

        // Screen inference may take longer than device writes; keep waiting through the server's 390 s budget.
        requests.start("assistant", "screen-1", startedAt);
        requests.accepted("screen-1", 10, "s1", "pending");
        Object screenPending = doc("", "{\"id\":\"screen-1\",\"status\":\"pending\"}", 10, "s1");
        notices = requests.reconcile(screenPending, startedAt + 180000);
        assert requests.get("assistant") != null && notices.isEmpty() : "slow screen checks must remain pending";
        notices = requests.reconcile(screenPending, startedAt + 390000);
        assert requests.get("assistant") != null && notices.isEmpty() : "allow time to read the final result";
        notices = requests.reconcile(doc("", "{\"id\":\"screen-1\",\"status\":\"confirmed\","
                + "\"message\":\"已检查，保留原便条。\"}", 10, "s1"), startedAt + 391000);
        assert !requests.any() && notices.equals(Collections.singletonList("已检查，保留原便条。"))
            : "an unchanged screen still needs visible completion feedback";
        assert requests.reconcile(confirmedData, startedAt + 392000).isEmpty() : "show completion only once";
        requests.start("assistant", "screen-2", startedAt);
        notices = requests.reconcile(confirmedData, startedAt + 401000);
        assert !requests.any() && notices.size() == 1 : "screen checks still have a bounded wait";
        requests.start("assistant", "screen-3", startedAt);
        notices = requests.reconcile(doc("", "{\"id\":\"screen-3\",\"status\":\"failed\","
                + "\"error\":\"当前为屏幕静默时段，便条未修改。\"}", 11, "s1"), startedAt + 2000);
        assert !requests.any() && notices.equals(Collections.singletonList("当前为屏幕静默时段，便条未修改。"));

        // Climate: absolute targets accumulate from the shown value; a pending mode change blocks temperature taps.
        Object shownClimate = requests.overlay(confirmedData);
        if (shownClimate == confirmedData)
            shownClimate = Json.copy(confirmedData);
        Optimistic.apply(shownClimate, "temp_up");
        String wireAction = Optimistic.wire(shownClimate, "temp_up");
        assert wireAction.equals("temp:heat:16.5") : wireAction;
        requests.start(wireAction, "id-8", startedAt);
        Object nextSnapshot = requests.overlay(confirmedData);
        Optimistic.apply(nextSnapshot, "temp_up");
        assert Optimistic.wire(nextSnapshot, "temp_up")
            .equals("temp:heat:17.0")
            : "a second + builds on the waiting target";
        requests.start("mode:cool", "id-9", startedAt);
        assert requests.modeChanging();
        assert Requests.keyOf("range:16:24").equals("climate") && Requests.keyOf("device:fan:on").equals("device:fan")
            && Requests.keyOf("assistant").equals("assistant");
        System.out.println(
            "Requests: overlay never edits HA data, waiting/unconfirmed marks, stale documents, superseding, failures, restarts, give-up and climate targets checked.");
    }
}
