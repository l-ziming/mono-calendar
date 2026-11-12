package dev.monocalendar.rp1;

import java.util.*;

/** Applies a Home Assistant action to the local data immediately, before the server confirms it. */
public final class Optimistic {
    private Optimistic() {
    }
    /** The action string sent to POST /action; the server validates it against its own state. */
    public static String wire(Object data, String action) {
        Map<String, Object> climate = Json.obj(data, "ac");
        Double target = Json.num(climate, "target");
        Double low = Json.num(climate, "low");
        Double high = Json.num(climate, "high");
        if (("temp_up".equals(action) || "temp_down".equals(action)) && target != null)
            return "temp:" + Json.str(climate, "mode") + ":" + target;
        if (action.startsWith("range_") && low != null && high != null)
            return "range:" + low + ":" + high;
        return action;
    }

    @SuppressWarnings("unchecked")
    public static void apply(Object data, String action) {
        if (!(data instanceof Map))
            return;
        Map<String, Object> root = (Map<String, Object>) data;
        if (action.startsWith("device:")) {
            // "device:<id>:on|off" carries the state the person asked for, never a blind toggle.
            String[] parts = action.split(":");
            if (parts.length != 3)
                return;
            String id = parts[1];
            boolean on = "on".equals(parts[2]);
            for (Object deviceValue : Json.list(root, "devices"))
                if (deviceValue instanceof Map && id.equals(Json.str(deviceValue, "id"))) {
                    Map<String, Object> device = (Map<String, Object>) deviceValue;
                    device.put("on", on);
                    if ("fan".equals(id)) {
                        if (on)
                            device.put("minutes", 15.0);
                        else
                            device.remove("minutes");
                    }
                }
            return;
        }
        Object climateValue = root.get("ac");
        if (!(climateValue instanceof Map))
            return;
        Map<String, Object> climate = (Map<String, Object>) climateValue;
        if (action.startsWith("mode:")) {
            climate.put("mode", action.substring(5));
            climate.remove("action");
            return;
        }
        // Absolute targets as sent to the server ("temp:heat:16.5", "temp:16.5", "range:16:24").
        if (action.startsWith("temp:")) {
            String[] parts = action.split(":");
            try {
                climate.put("target", Double.parseDouble(parts[parts.length - 1]));
            } catch (NumberFormatException ignored) {
            }
            return;
        }
        if (action.startsWith("range:")) {
            String[] parts = action.split(":");
            try {
                if (parts.length == 3) {
                    climate.put("low", Double.parseDouble(parts[1]));
                    climate.put("high", Double.parseDouble(parts[2]));
                }
            } catch (NumberFormatException ignored) {
            }
            return;
        }
        Double target = Json.num(climate, "target");
        Double low = Json.num(climate, "low");
        Double high = Json.num(climate, "high");
        Double minimum = Json.num(climate, "min");
        Double maximum = Json.num(climate, "max");
        Double spacing = Json.num(climate, "gap");
        double min = Math.max(5, minimum == null ? 5 : minimum);
        double max = Math.min(32, maximum == null ? 32 : maximum);
        double gap = spacing == null ? 2 : spacing;
        switch (action) {
            case "temp_up":
                if (target != null)
                    climate.put("target", Math.min(Math.min(30, max), target + 0.5));
                break;
            case "temp_down":
                if (target != null)
                    climate.put("target", Math.max(min, target - 0.5));
                break;
            case "range_low_up":
                if (low != null && high != null)
                    climate.put("low", Math.min(high - gap, low + 0.5));
                break;
            case "range_low_down":
                if (low != null)
                    climate.put("low", Math.max(min, low - 0.5));
                break;
            case "range_high_up":
                if (high != null)
                    climate.put("high", Math.min(max, high + 0.5));
                break;
            case "range_high_down":
                if (low != null && high != null)
                    climate.put("high", Math.max(low + gap, high - 0.5));
                break;
            default:
                break;
        }
    }
}
