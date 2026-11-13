package dev.monocalendar.rp1;

import java.util.HashMap;
import java.util.Map;

/** Runs the receiver source with in-memory Android boundaries. */
public final class WakeReceiverCheck {
    private static final String RETRY = "dev.monocalendar.rp1.HINT_RETRY";

    private static Context ready() {
        WakeReceiver.release();
        Context context = new Context();
        context.preferences.values.put("endpoint", "http://localhost");
        context.preferences.values.put("scheduled", true);
        return context;
    }

    private static void deliver(Context context, String action, long due) {
        new WakeReceiver().onReceive(context, new Intent().setAction(action).putExtra("scheduled_at", due));
    }

    private static void scheduledOnce(Context context, boolean retry) {
        assert context.alarms.quarterSets == 1 && context.alarms.quarterCancels == 0;
        if (retry)
            assert context.alarms.hintSets == 1 && context.alarms.hintCancels == 0;
        else
            assert context.alarms.hintSets == 0 && context.alarms.hintCancels == 1;
    }

    private static void idle(Context context) {
        assert context.started == 0 && context.power.acquires == 0;
    }

    public static void main(String[] args) {
        for (String disabled : new String[] {"endpoint", "scheduled", "exited"}) {
            Context context = ready();
            if (disabled.equals("endpoint"))
                context.preferences.values.put(disabled, "");
            else if (disabled.equals("scheduled"))
                context.preferences.values.put(disabled, false);
            else
                context.preferences.values.put(disabled, true);
            deliver(context, WakeReceiver.TICK, 0);
            assert context.alarms.quarterCancels == 1 && context.alarms.hintCancels == 1;
            assert context.alarms.quarterSets == 0 && context.alarms.hintSets == 0;
            idle(context);
        }

        Context early = ready();
        long future = System.currentTimeMillis() + 60000;
        early.preferences.values.put("hint_due", future);
        deliver(early, RETRY, future);
        scheduledOnce(early, true);
        assert early.preferences.getLong("hint_due", 0) == future;
        assert early.alarms.hintDue == future;
        assert early.preferences.getInt("hint_attempts", 0) == 0;
        idle(early);

        Context stale = ready();
        stale.preferences.values.put("hint_due", future);
        deliver(stale, RETRY, future - 60000);
        scheduledOnce(stale, true);
        assert stale.alarms.hintDue == future;
        assert stale.alarms.hint.intent.getLongExtra("scheduled_at", 0) == future;
        assert stale.preferences.getInt("hint_attempts", 0) == 0;
        idle(stale);

        Context cleared = ready();
        deliver(cleared, RETRY, future);
        scheduledOnce(cleared, false);
        idle(cleared);

        Context unsaved = ready();
        long past = System.currentTimeMillis() - 1000;
        unsaved.preferences.values.put("hint_due", past);
        unsaved.preferences.commitSucceeds = false;
        long before = System.currentTimeMillis();
        deliver(unsaved, RETRY, past);
        long after = System.currentTimeMillis();
        scheduledOnce(unsaved, true);
        assert unsaved.preferences.getLong("hint_due", 0) == past;
        assert unsaved.preferences.getInt("hint_attempts", 0) == 0;
        assert unsaved.alarms.hintDue >= before + 1000 && unsaved.alarms.hintDue <= after + 1000;
        assert unsaved.alarms.hint.intent.getLongExtra("scheduled_at", 0) == past;
        idle(unsaved);

        Context retry = ready();
        retry.preferences.values.put("hint_due", past);
        before = System.currentTimeMillis();
        deliver(retry, RETRY, past);
        after = System.currentTimeMillis();
        scheduledOnce(retry, true);
        assert retry.preferences.getInt("hint_attempts", 0) == 1;
        long next = retry.preferences.getLong("hint_due", 0);
        assert next >= before + 120000 && next <= after + 120000;
        assert retry.alarms.hintDue == next;
        assert retry.started == 1 && retry.power.acquires == 1;
        assert retry.lastActivity.getBooleanExtra("quarter", false);

        Context lastRetry = ready();
        lastRetry.preferences.values.put("hint_due", past);
        lastRetry.preferences.values.put("hint_attempts", 2);
        deliver(lastRetry, RETRY, past);
        scheduledOnce(lastRetry, false);
        assert lastRetry.preferences.getInt("hint_attempts", 0) == 3;
        assert lastRetry.preferences.getLong("hint_due", -1) == 0;
        assert lastRetry.started == 1 && lastRetry.power.acquires == 1;

        Context duplicate = ready();
        long attempted = System.currentTimeMillis();
        duplicate.preferences.values.put("alarm_attempt", attempted);
        deliver(duplicate, WakeReceiver.TICK, attempted);
        scheduledOnce(duplicate, false);
        assert duplicate.preferences.getLong("alarm_attempt", -1) == attempted;
        idle(duplicate);

        Context tick = ready();
        deliver(tick, WakeReceiver.TICK, 0);
        scheduledOnce(tick, false);
        assert tick.preferences.getLong("alarm_attempt", -1) > 0;
        assert tick.started == 1 && tick.power.acquires == 1;

        Context boot = ready();
        boot.preferences.values.put("hint_due", future);
        deliver(boot, "android.intent.action.BOOT_COMPLETED", 0);
        scheduledOnce(boot, true);
        idle(boot);

        Context failedActivity = ready();
        failedActivity.failStart = true;
        deliver(failedActivity, WakeReceiver.TICK, 0);
        scheduledOnce(failedActivity, false);
        assert failedActivity.power.acquires == 1 && !failedActivity.power.last.isHeld();
        WakeReceiver.release();
        System.out.println("Java actual-source WakeReceiver rearming, retry guards, persistence failure, duplicate ticks and wake-lock cleanup passed.");
    }
}

abstract class BroadcastReceiver {
    public abstract void onReceive(Context context, Intent intent);
}

final class MainActivity {}

final class Context {
    static final int MODE_PRIVATE = 0;
    static final String ALARM_SERVICE = "alarm";
    static final String POWER_SERVICE = "power";
    final SharedPreferences preferences = new SharedPreferences();
    final AlarmManager alarms = new AlarmManager();
    final PowerManager power = new PowerManager();
    int started;
    boolean failStart;
    Intent lastActivity;

    SharedPreferences getSharedPreferences(String name, int mode) {
        return preferences;
    }

    Object getSystemService(String name) {
        if (ALARM_SERVICE.equals(name))
            return alarms;
        if (POWER_SERVICE.equals(name))
            return power;
        throw new AssertionError(name);
    }

    void startActivity(Intent intent) {
        started++;
        if (failStart)
            throw new RuntimeException("Activity unavailable");
        lastActivity = intent;
    }
}

final class SharedPreferences {
    final Map<String, Object> values = new HashMap<>();
    boolean commitSucceeds = true;

    String getString(String key, String fallback) {
        if (values.containsKey(key))
            return (String) values.get(key);
        return fallback;
    }

    boolean getBoolean(String key, boolean fallback) {
        if (values.containsKey(key))
            return (Boolean) values.get(key);
        return fallback;
    }

    int getInt(String key, int fallback) {
        if (values.containsKey(key))
            return (Integer) values.get(key);
        return fallback;
    }

    long getLong(String key, long fallback) {
        if (values.containsKey(key))
            return (Long) values.get(key);
        return fallback;
    }

    Editor edit() {
        return new Editor();
    }

    final class Editor {
        private final Map<String, Object> pending = new HashMap<>(values);

        Editor putInt(String key, int value) {
            pending.put(key, value);
            return this;
        }

        Editor putLong(String key, long value) {
            pending.put(key, value);
            return this;
        }

        Editor putBoolean(String key, boolean value) {
            pending.put(key, value);
            return this;
        }

        Editor remove(String key) {
            pending.remove(key);
            return this;
        }

        boolean commit() {
            if (!commitSucceeds)
                return false;
            apply();
            return true;
        }

        void apply() {
            values.clear();
            values.putAll(pending);
        }
    }
}

final class Intent {
    static final int FLAG_ACTIVITY_NEW_TASK = 1;
    static final int FLAG_ACTIVITY_CLEAR_TOP = 2;
    static final int FLAG_ACTIVITY_SINGLE_TOP = 4;
    private String action;
    private final Map<String, Object> extras = new HashMap<>();

    Intent() {}
    Intent(Context context, Class<?> target) {}

    Intent setAction(String value) {
        action = value;
        return this;
    }

    String getAction() {
        return action;
    }

    Intent putExtra(String key, long value) {
        extras.put(key, value);
        return this;
    }

    Intent putExtra(String key, boolean value) {
        extras.put(key, value);
        return this;
    }

    long getLongExtra(String key, long fallback) {
        if (extras.containsKey(key))
            return (Long) extras.get(key);
        return fallback;
    }

    boolean getBooleanExtra(String key, boolean fallback) {
        if (extras.containsKey(key))
            return (Boolean) extras.get(key);
        return fallback;
    }

    Intent addFlags(int flags) {
        return this;
    }
}

final class PendingIntent {
    static final int FLAG_UPDATE_CURRENT = 1;
    final int code;
    final Intent intent;

    private PendingIntent(int code, Intent intent) {
        this.code = code;
        this.intent = intent;
    }

    static PendingIntent getBroadcast(Context context, int code, Intent intent, int flags) {
        return new PendingIntent(code, intent);
    }
}

final class AlarmManager {
    static final int RTC_WAKEUP = 0;
    int quarterSets;
    int quarterCancels;
    int hintSets;
    int hintCancels;
    long hintDue;
    PendingIntent hint;

    void setWindow(int type, long due, long window, PendingIntent intent) {
        assert type == RTC_WAKEUP && window == 1000;
        if (intent.code == 1)
            quarterSets++;
        else {
            assert intent.code == 2;
            hintSets++;
            hintDue = due;
            hint = intent;
        }
    }

    void cancel(PendingIntent intent) {
        if (intent.code == 1)
            quarterCancels++;
        else {
            assert intent.code == 2;
            hintCancels++;
        }
    }
}

final class PowerManager {
    static final int SCREEN_DIM_WAKE_LOCK = 1;
    static final int ACQUIRE_CAUSES_WAKEUP = 2;
    int acquires;
    WakeLock last;

    WakeLock newWakeLock(int flags, String tag) {
        last = new WakeLock();
        return last;
    }

    final class WakeLock {
        private boolean held;

        void setReferenceCounted(boolean value) {}

        void acquire(long timeout) {
            assert timeout == 45000;
            held = true;
            acquires++;
        }

        boolean isHeld() {
            return held;
        }

        void release() {
            held = false;
        }
    }
}
