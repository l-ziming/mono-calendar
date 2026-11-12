package dev.monocalendar.rp1;

import java.text.SimpleDateFormat;
import java.util.*;

/** Pure Java policy, also exercised by tests/QuarterClockCheck.java when a JDK is available. */
public final class QuarterClock {
    public static final long INTERVAL = 15 * 60 * 1000L;
    /** Local hours [NIGHT_FROM, NIGHT_TO) wake only on the hour to save power; a tap still refreshes at once. */
    public static final int NIGHT_FROM = 0, NIGHT_TO = 6;
    private QuarterClock() {
    }
    public static long next(long now, TimeZone zone) {
        Calendar calendar = Calendar.getInstance(zone);
        calendar.setTimeInMillis(now);
        int minutesUntilQuarter = 15 - calendar.get(Calendar.MINUTE) % 15;
        // Read wall-clock fields, then add elapsed time. Mutating Calendar during
        // the repeated DST hour can silently select its second occurrence.
        long due = now + minutesUntilQuarter * 60000L - calendar.get(Calendar.SECOND) * 1000L
            - calendar.get(Calendar.MILLISECOND);
        for (;;) {
            calendar.setTimeInMillis(due);
            int hour = calendar.get(Calendar.HOUR_OF_DAY);
            if (hour < NIGHT_FROM || hour >= NIGHT_TO || calendar.get(Calendar.MINUTE) == 0)
                return due;
            due += INTERVAL;
        }
    }
    public static boolean sameSlot(long a, long b) {
        return a >= 0 && b >= 0 && a / INTERVAL == b / INTERVAL;
    }
    public static boolean wakeEnabled(boolean configured, boolean scheduled, boolean exited) {
        return configured && scheduled && !exited;
    }
    public static String cleanDate(long now, TimeZone zone, String previous) {
        Calendar calendar = Calendar.getInstance(zone);
        calendar.setTimeInMillis(now);
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        formatter.setTimeZone(zone);
        String day = formatter.format(new Date(now));
        return calendar.get(Calendar.HOUR_OF_DAY) == 3 && calendar.get(Calendar.MINUTE) < 15 && !day.equals(previous)
            ? day
            : null;
    }
    public static String warning(long checked, long updated, int battery, boolean wifi, TimeZone zone) {
        List<String> parts = new ArrayList<>();
        if (!wifi)
            parts.add("网络未连接");
        if (updated <= 0)
            parts.add("尚未更新");
        else if (checked - updated >= INTERVAL) {
            SimpleDateFormat formatter = new SimpleDateFormat("HH:mm", Locale.US);
            formatter.setTimeZone(zone);
            parts.add(
                "截至 " + formatter.format(new Date(checked)) + " 已 " + ((checked - updated) / 60000) + " 分钟未更新");
        }
        if (battery >= 0 && battery <= 20)
            parts.add("请充电");
        StringBuilder result = new StringBuilder();
        for (String part : parts) {
            if (result.length() > 0)
                result.append('，');
            result.append(part);
        }
        return result.toString();
    }
}
