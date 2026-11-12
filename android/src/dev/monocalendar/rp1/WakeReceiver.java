package dev.monocalendar.rp1;

import android.app.*;
import android.content.*;
import android.os.PowerManager;
import java.util.TimeZone;

/** API 22: bounded one-shot RTC alarms, re-armed on delivery, boot and clock changes. */
public final class WakeReceiver extends BroadcastReceiver {
    public static final String TICK = "dev.monocalendar.rp1.QUARTER";
    private static PowerManager.WakeLock wake;
    private static PendingIntent alarm(Context context, long due) {
        return PendingIntent.getBroadcast(context, 1,
            new Intent(context, WakeReceiver.class).setAction(TICK).putExtra("scheduled_at", due),
            PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private static boolean enabled(SharedPreferences preferences) {
        return QuarterClock.wakeEnabled(!preferences.getString("endpoint", "").isEmpty(),
            preferences.getBoolean("scheduled", true), preferences.getBoolean("exited", false));
    }
    public static boolean setExited(Context context, boolean exited) {
        if (!context.getSharedPreferences("connection", Context.MODE_PRIVATE)
                 .edit()
                 .putBoolean("exited", exited)
                 .commit())
            return false;
        schedule(context);
        if (exited)
            release();
        return true;
    }
    public static void schedule(Context context) {
        SharedPreferences preferences = context.getSharedPreferences("connection", Context.MODE_PRIVATE);
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (!enabled(preferences)) {
            manager.cancel(alarm(context, 0));
            return;
        }
        TimeZone zone = TimeZone.getTimeZone(preferences.getString("display_timezone", TimeZone.getDefault().getID()));
        long due = QuarterClock.next(System.currentTimeMillis(), zone);
        // Sony widens setExact alarms by minutes; a positive window stays bounded.
        manager.setWindow(AlarmManager.RTC_WAKEUP, due, 1000, alarm(context, due));
    }
    /** RP1 runs API 22: this bounded legacy screen lock wakes the actual EPD display. */
    public static synchronized void wakeScreen(Context context, String tag) {
        release();
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        wake = power.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, tag);
        wake.setReferenceCounted(false);
        wake.acquire(45000);
    }
    public static synchronized void release() {
        if (wake != null && wake.isHeld())
            wake.release();
        wake = null;
    }
    @Override
    public void onReceive(Context context, Intent intent) {
        schedule(context);
        if (!TICK.equals(intent.getAction()))
            return;
        SharedPreferences preferences = context.getSharedPreferences("connection", Context.MODE_PRIVATE);
        if (!enabled(preferences))
            return;
        long now = System.currentTimeMillis();
        if (QuarterClock.sameSlot(now, preferences.getLong("alarm_attempt", -1)))
            return;
        preferences.edit().putLong("alarm_attempt", now).apply();
        wakeScreen(context, "monocalendar:quarter");
        try {
            context.startActivity(
                new Intent(context, MainActivity.class)
                    .putExtra("quarter", true)
                    .putExtra("wake_lag_ms", Math.max(0, now - intent.getLongExtra("scheduled_at", now)))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        } catch (RuntimeException error) {
            release();
        }
    }
}
