package dev.monocalendar.rp1;

import android.app.Activity;
import android.content.*;
import android.graphics.*;
import android.net.*;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.concurrent.*;

/**
 * Draws the whole page on the RP1 and handles every tap locally; the server only supplies /data.
 * Calendar navigation never touches the network. Home Assistant writes never edit the cached data:
 * `data` is always what HA confirmed, and outstanding writes (Requests) are drawn over it as
 * "waiting" or "unconfirmed" until /data reports their outcome. After a write the App reads /data
 * back on a short schedule of its own; the quarter-hour sync stays the power-saving default.
 * The App only reads whether Wi-Fi is connected; it never enables, disables or reconnects it.
 */
public final class MainActivity extends Activity implements SurfaceHolder.Callback {
    private static final long IDLE_RESET_MS = 5 * 60 * 1000L, MENU_IDLE_MS = 10000, CARD_MS = 10000, HINT_ARM_MS = 5000,
                              NOTICE_MS = 15000, AWAKE_MS = 60000, INTERACTIVE_POLL_MS = 10000;
    private static volatile MainActivity active;
    private static boolean sony;
    static {
        try {
            System.loadLibrary("rp1_epd");
            sony = true;
        } catch (UnsatisfiedLinkError e) {
            sony = false;
        }
    }
    private static native boolean refreshHint(Surface surface, int mode, int left, int top, int right, int bottom);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService posts = Executors.newSingleThreadExecutor(),
                                  reads = Executors.newSingleThreadExecutor();
    private final RemoteState remote = new RemoteState();
    private final Requests requests = new Requests();
    private final Page.State state = new Page.State();
    private SharedPreferences prefs;
    private SurfaceView surface;
    private Page page;
    private AndroidInk ink;
    private Bitmap shown, next;
    private List<Page.Target> targets = Collections.emptyList();
    private Object data = new LinkedHashMap<String, Object>();
    private boolean ready, exiting, connected, quarter, readingBack;
    private long awakeUntil;
    private long lastTouch, checked, updated, noticeUntil;
    private String notice = "";
    private float downX, downY;
    private long menuTouched;
    private final Runnable closeMenu = () -> {
        if (state.menu && SystemClock.uptimeMillis() - menuTouched >= MENU_IDLE_MS) {
            state.menu = false;
            state.exitArm = false;
            render(false);
        }
    };
    /**
     * Sony's standby manager sleeps the RP1 about one second after a wake; while someone is using the
     *  panel, keep it awake for a minute after the last touch so taps keep arriving. Quarter wakes skip this.
     */
    private final Runnable sleepAgain = ()
        -> getWindow().clearFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    private void keepAwake() {
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        awakeUntil = SystemClock.elapsedRealtime() + AWAKE_MS;
        ui.removeCallbacks(sleepAgain);
        ui.postDelayed(sleepAgain, AWAKE_MS);
        if (!readingBack && !requests.any())
            scheduleReadback(INTERACTIVE_POLL_MS);
    } // never delays a pending fast read-back
    private final Runnable readback = this::readBack;
    private final Runnable disarmHint = () -> {
        if (state.hintArm) {
            state.hintArm = false;
            render(false);
        }
    };
    private final Runnable closeCard = () -> {
        if (state.card != null) {
            state.card = null;
            render(false);
        }
    };
    /** The hint icon (128 x 128 grey) from HA's image entity, cached with the version /data names. */
    private byte[] icon;
    private boolean iconLoading;
    private final Runnable clearNotice = () -> {
        if (!notice.isEmpty() && System.currentTimeMillis() >= noticeUntil) {
            notice = "";
            render(false);
        }
    };
    /** Static nested class: this D8 build rejects javac 21's inner and anonymous class attributes. */
    static final class Synced extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            MainActivity activity = active;
            if (activity != null)
                activity.onSynced(intent);
        }
    }
    private final BroadcastReceiver synced = new Synced();
    /** Follows the system's Wi-Fi (read only): a drop just redraws the warning, a reconnect syncs at once. */
    static final class Network extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            MainActivity activity = active;
            if (activity != null)
                activity.onNetwork();
        }
    }
    private final BroadcastReceiver network = new Network();
    /** Plug, unplug and full charge redraw the battery icon; ordinary level changes wait for the next redraw. */
    static final class Power extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            MainActivity activity = active;
            if (activity != null)
                activity.onPower(intent);
        }
    }
    private final BroadcastReceiver power = new Power();
    private int powerState = -1;
    private static int powerState(Intent b) {
        if (b == null || b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) == 0)
            return 0;
        int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
            scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        // Some chargers keep reporting "charging" at 100 %: count that as full too.
        return b.getIntExtra(BatteryManager.EXTRA_STATUS, 0) == BatteryManager.BATTERY_STATUS_FULL
                || scale > 0 && level >= scale
            ? 2
            : 1;
    }
    private void onPower(Intent b) {
        int s = powerState(b);
        if (s == powerState || exiting)
            return;
        boolean first = powerState < 0;
        powerState = s;
        // Sony wakes the panel on plug-in only; unplug and full charge take a bounded wake and redraw like a quarter
        // wake.
        if (!first && !((PowerManager) getSystemService(POWER_SERVICE)).isInteractive()) {
            quarter = true;
            WakeReceiver.wakeScreen(this, "monocalendar:power");
        } else
            render(false);
    }
    private static final long WIFI_WAIT_MS = 20000;
    private boolean waitingWifi;
    private final Runnable wifiGaveUp = () -> {
        if (waitingWifi) {
            waitingWifi = false;
            markFailure(System.currentTimeMillis());
        }
    };
    private void onNetwork() {
        if (exiting)
            return;
        if (wifi()) {
            waitingWifi = false;
            ui.removeCallbacks(wifiGaveUp);
            sync();
        } else
            render(false);
    }

    @Override
    public void onCreate(Bundle saved) {
        super.onCreate(saved);
        active = this;
        prefs = getSharedPreferences("connection", MODE_PRIVATE);
        quarter = getIntent().getBooleanExtra("quarter", false);
        if (quarter && prefs.getBoolean("exited", false)) {
            close();
            return;
        }
        if (!quarter)
            prefs.edit().putBoolean("exited", false).commit();
        updated = prefs.getLong("last_data", 0);
        checked = prefs.getLong("last_check", System.currentTimeMillis());
        connected = prefs.getBoolean("last_network_ok", false);
        try {
            page = new Page(new Almanac(getAssets().open("almanac.bin"), getAssets().open("almanac-lists.txt")));
        } catch (IOException missing) {
            throw new IllegalStateException("almanac asset missing", missing);
        }
        ink = new AndroidInk(getAssets());
        shown = Bitmap.createBitmap(Page.W, Page.H, Bitmap.Config.ARGB_8888);
        next = Bitmap.createBitmap(Page.W, Page.H, Bitmap.Config.ARGB_8888);
        loadCache();
        loadIcon();
        registerReceiver(synced, new IntentFilter(SyncService.DONE));
        registerReceiver(network, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));
        registerReceiver(power, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        surface = new SurfaceView(this);
        surface.getHolder().addCallback(this);
        surface.setOnTouchListener((v, e) -> touch(e));
        setContentView(surface);
        hideBars();
        WakeReceiver.schedule(this);
    }
    @Override
    protected void onResume() {
        super.onResume();
        if (exiting)
            return;
        hideBars();
        if (!quarter)
            keepAwake();
        if (quarter)
            onQuarter();
        else
            sync();
        quarter = false;
    }
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra("quarter", false)) {
            if (prefs.getBoolean("exited", false)) {
                close();
                return;
            }
            quarter = true;
        } else
            WakeReceiver.setExited(this, false);
    }
    @Override
    protected void onDestroy() {
        exiting = true;
        ui.removeCallbacksAndMessages(null);
        try {
            unregisterReceiver(synced);
            unregisterReceiver(network);
            unregisterReceiver(power);
        } catch (RuntimeException ignored) {
        }
        posts.shutdownNow();
        reads.shutdownNow();
        if (active == this) {
            WakeReceiver.release();
            active = null;
        }
        super.onDestroy();
    }
    public static void finishActive() {
        MainActivity a = active;
        if (a != null)
            a.close();
    }
    public static void clearCache(Context context) {
        context.deleteFile(SyncService.FILE);
    }
    private void close() {
        exiting = true;
        ui.removeCallbacksAndMessages(null);
        WakeReceiver.release();
        finishAndRemoveTask();
    }
    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus && !exiting)
            hideBars();
    }
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(5894);
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        ready = true;
    }
    @Override
    public void surfaceChanged(SurfaceHolder h, int format, int w, int height) {
        render(true);
    }
    @Override
    public void surfaceDestroyed(SurfaceHolder h) {
        ready = false;
    }

    // ---------------------------------------------------------------- data
    private TimeZone zone() {
        String z = Json.str(data, "timezone");
        if (z == null)
            z = prefs.getString("display_timezone", TimeZone.getDefault().getID());
        return TimeZone.getTimeZone(z);
    }
    private void loadCache() {
        File f = new File(getFilesDir(), SyncService.FILE);
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = SyncService.readBytes(in, 2_000_000, Long.MAX_VALUE);
            data = Json.parse(new String(b, "UTF-8"));
        } catch (Exception missing) {
            data = new LinkedHashMap<String, Object>();
        }
    }
    private void onQuarter() {
        // A quarter wake always redraws (clock, shichen, warnings) and fetches once.
        if (System.currentTimeMillis() - lastTouch >= IDLE_RESET_MS) {
            state.selected = Long.MIN_VALUE;
            state.menu = false;
            state.exitArm = false;
            state.card = null;
            state.hintArm = false;
        }
        String clean =
            QuarterClock.cleanDate(System.currentTimeMillis(), zone(), prefs.getString("last_clean_date", ""));
        render(clean != null);
        if (clean != null)
            prefs.edit().putString("last_clean_date", clean).apply();
        sync();
    }
    private void sync() {
        String endpoint = prefs.getString("endpoint", "");
        String token = prefs.getString("token", "");
        if (endpoint.isEmpty() || token.isEmpty()) {
            setNotice("等待配置服务地址");
            WakeReceiver.release();
            return;
        }
        // No Wi-Fi yet (it may still be reconnecting after a wake): wait for the system broadcast, then give up once.
        if (!wifi()) {
            if (!waitingWifi) {
                waitingWifi = true;
                ui.postDelayed(wifiGaveUp, WIFI_WAIT_MS);
            }
            return;
        }
        final long id = remote.beginRead();
        if (id == 0)
            return;
        startService(
            new Intent(this, SyncService.class)
                .putExtra("endpoint", endpoint)
                .putExtra("token", token)
                .putExtra("etag", new File(getFilesDir(), SyncService.FILE).exists() ? prefs.getString("etag", "") : "")
                .putExtra("requestId", id));
        ui.postDelayed(() -> {
            if (remote.finishRead(id))
                markFailure(System.currentTimeMillis());
        }, 25000);
    }
    private void onSynced(Intent i) {
        if (exiting)
            return;
        long id = i.getLongExtra("requestId", 0);
        File pending = new File(getFilesDir(), SyncService.pending(id));
        int code = i.getIntExtra("code", -1);
        long started = i.getLongExtra("started", System.currentTimeMillis()), dataTime = i.getLongExtra("dataTime", 0);
        if (!remote.finishRead(id)) {
            pending.delete();
            WakeReceiver.release();
            return;
        }
        if (code == 200 || code == 304) {
            if (code == 200 && !adopt(pending, i.getStringExtra("etag"), dataTime)) {
                pending.delete();
                markFailure(started);
                return;
            }
            reached(started, dataTime);
        } else {
            pending.delete();
            if (code == 401)
                setNotice("连接认证失败");
            markFailure(started);
        }
        WakeReceiver.release();
    }
    private void markFailure(long at) {
        connected = false;
        checked = at;
        prefs.edit().putLong("last_check", checked).putBoolean("last_network_ok", false).apply();
        render(false);
        WakeReceiver.release();
    }
    /** Commits a fetched document if it is not older than the one shown; false if it could not be stored. */
    private boolean adopt(File pending, String etag, long dataTime) {
        Object fresh;
        try (FileInputStream in = new FileInputStream(pending)) {
            fresh = Json.parse(new String(SyncService.readBytes(in, 2_000_000, Long.MAX_VALUE), "UTF-8"));
        } catch (Exception unreadable) {
            return false;
        }
        if (!RemoteState.canAcceptDataTime(data, dataTime)) {
            pending.delete();
            return true;
        } // a slower, older reply: keep what we have
        if (!pending.renameTo(new File(getFilesDir(), SyncService.FILE)))
            return false;
        data = fresh;
        prefs.edit().putString("etag", etag == null ? "" : etag).apply();
        return true;
    }
    /** A successful read (200 or 304): fold request outcomes in, redraw, and plan the next read-back. */
    private void reached(long started, long dataTime) {
        connected = true;
        checked = started;
        if (dataTime > 0 && dataTime >= updated)
            updated = dataTime;
        String tz = Json.str(data, "timezone");
        SharedPreferences.Editor e = prefs.edit()
                                         .putLong("last_data", updated)
                                         .putLong("last_check", checked)
                                         .putBoolean("last_network_ok", true);
        if (tz != null)
            e.putString("display_timezone", tz);
        e.apply();
        for (String n : requests.reconcile(data, SystemClock.elapsedRealtime()))
            setNotice(n);
        render(false);
        planReadback();
        fetchIcon();
    }
    private void setNotice(String text) {
        notice = text;
        noticeUntil = System.currentTimeMillis() + NOTICE_MS;
        ui.removeCallbacks(clearNotice);
        ui.postDelayed(clearNotice, NOTICE_MS + 50);
        render(false);
    }

    // ---------------------------------------------------------------- status
    private boolean wifi() {
        ConnectivityManager m = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo n = m == null ? null : m.getActiveNetworkInfo();
        return n != null && n.isConnected() && n.getType() == ConnectivityManager.TYPE_WIFI;
    }
    private Page.Status status() {
        Page.Status status = new Page.Status();
        boolean wifiConnected = wifi();
        status.icon = icon;
        Intent batteryIntent = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int batteryLevel = batteryIntent == null ? -1 : batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
            batteryScale = batteryIntent == null ? 100 : batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        status.wifi = wifiConnected;
        status.battery = batteryLevel < 0 || batteryScale <= 0 ? -1 : batteryLevel * 100 / batteryScale;
        powerState = powerState(batteryIntent);
        status.charging = powerState > 0;
        status.full = powerState == 2;
        // No 请充电 while plugged in.
        String warning = QuarterClock.warning(
            checked, updated, status.charging ? -1 : status.battery, wifiConnected && connected, zone());
        if (connected && !Json.bool(data, "online"))
            warning += (warning.isEmpty() ? "" : "，") + "Home Assistant 暂不可用";
        if (!notice.isEmpty())
            warning += (warning.isEmpty() ? "" : "，") + notice;
        status.warning = warning;
        return status;
    }

    // ---------------------------------------------------------------- drawing
    /** Draws off screen, compares with what is shown, and refreshes only the regions that changed. */
    private void render(boolean full) {
        if (exiting || page == null)
            return;
        ink.setCanvas(new Canvas(next));
        targets = page.draw(ink, requests.overlay(data), state, status(), System.currentTimeMillis(), zone());
        List<Rect> dirty = new ArrayList<>();
        if (full)
            dirty.add(new Rect(0, 0, Page.W, Page.H));
        else
            for (float[] r : Page.REGIONS) {
                Rect rect = new Rect((int) r[0], (int) r[1], (int) Math.ceil(r[2]), (int) Math.ceil(r[3]));
                if (changed(rect))
                    dirty.add(rect);
            }
        Bitmap swap = shown;
        shown = next;
        next = swap;
        if (!ready || dirty.isEmpty())
            return;
        for (Rect r : dirty)
            present(r, full);
    }
    private final int[] rowA = new int[Page.W], rowB = new int[Page.W];
    private boolean changed(Rect r) {
        int w = r.width();
        for (int y = r.top; y < r.bottom; y++) {
            next.getPixels(rowA, 0, w, r.left, y, w, 1);
            shown.getPixels(rowB, 0, w, r.left, y, w, 1);
            for (int x = 0; x < w; x++)
                if (rowA[x] != rowB[x])
                    return true;
        }
        return false;
    }
    private void present(Rect region, boolean clean) {
        RectF target = targetRect();
        Rect dirty = new Rect((int) (target.left + region.left * target.width() / Page.W),
            (int) (target.top + region.top * target.height() / Page.H),
            (int) Math.ceil(target.left + region.right * target.width() / Page.W),
            (int) Math.ceil(target.top + region.bottom * target.height() / Page.H));
        Rect requested = new Rect(dirty);
        Canvas c = null;
        try {
            c = surface.getHolder().lockCanvas(dirty);
            if (c == null)
                return;
            c.save();
            c.clipRect(dirty);
            c.drawColor(Color.WHITE);
            Paint p = new Paint();
            p.setFilterBitmap(false);
            c.drawBitmap(shown, null, target, p);
            c.restore();
            if (sony)
                refreshHint(surface.getHolder().getSurface(), clean ? 8226 : 16386, requested.left, requested.top,
                    requested.right, requested.bottom);
        } catch (RuntimeException ignored) {
        } finally {
            if (c != null)
                surface.getHolder().unlockCanvasAndPost(c);
        }
    }
    private RectF targetRect() {
        float s = Math.min(surface.getWidth() / (float) Page.W, surface.getHeight() / (float) Page.H), w = Page.W * s,
              h = Page.H * s;
        return new RectF((surface.getWidth() - w) / 2, (surface.getHeight() - h) / 2, (surface.getWidth() + w) / 2,
            (surface.getHeight() + h) / 2);
    }

    // ---------------------------------------------------------------- touch
    private boolean touch(MotionEvent e) {
        if (exiting)
            return true;
        if (e.getAction() == MotionEvent.ACTION_DOWN) {
            boolean asleep = SystemClock.elapsedRealtime() >= awakeUntil;
            keepAwake();
            downX = e.getX();
            downY = e.getY();
            if (asleep) {
                render(false);
                scheduleReadback(0);
            } // the screen may be an hour old at night: refresh on the first tap
            return true;
        }
        if (e.getAction() != MotionEvent.ACTION_UP || Math.hypot(e.getX() - downX, e.getY() - downY) > 35)
            return true;
        RectF t = targetRect();
        if (!t.contains(e.getX(), e.getY()))
            return true;
        float x = (e.getX() - t.left) * Page.W / t.width(), y = (e.getY() - t.top) * Page.H / t.height();
        String action = null;
        for (int i = targets.size() - 1; i >= 0; i--)
            if (targets.get(i).contains(x, y)) {
                action = targets.get(i).action;
                break;
            }
        lastTouch = System.currentTimeMillis();
        if (state.menu && (action == null || !action.startsWith("menu"))) {
            state.menu = false;
            state.exitArm = false;
            render(false);
            return true;
        }
        if (action != null)
            act(action);
        return true;
    }
    private void act(String action) {
        if (action.equals("menu")) {
            state.menu = !state.menu;
            state.exitArm = false;
            armMenu();
            render(false);
            return;
        }
        if (action.startsWith("menu:")) {
            armMenu();
            switch (action) {
                case "menu:refresh":
                    state.menu = false;
                    render(false);
                    sync();
                    return;
                case "menu:settings":
                    state.menu = false;
                    render(false);
                    try {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    } catch (RuntimeException unavailable) {
                        setNotice("无法打开系统设置");
                    }
                    return;
                case "menu:exit":
                    if (!state.exitArm) {
                        state.exitArm = true;
                        render(false);
                        return;
                    }
                    state.menu = false;
                    if (WakeReceiver.setExited(this, true))
                        close();
                    else
                        setNotice("退出未完成，请重试");
                    return;
                default:
                    state.menu = false;
                    state.exitArm = false;
                    render(false);
                    return;
            }
        }
        if (action.startsWith("card:")) {
            // A tapped yi/ji word, day meta or term opens its explanation for 10 s; a tap on the card closes it.
            String[] p = action.split(":", 3);
            ui.removeCallbacks(closeCard);
            if (p.length == 3) {
                state.cardKind = p[1];
                state.card = p[2];
                ui.postDelayed(closeCard, CARD_MS);
            } else
                state.card = null;
            render(false);
            return;
        }
        if (action.equals("hint")) {
            ui.removeCallbacks(disarmHint);
            if (requests.get("assistant") != null)
                return; // already 更新中
            if (!state.hintArm) {
                state.hintArm = true;
                ui.postDelayed(disarmHint, HINT_ARM_MS);
                render(false);
                return;
            }
            state.hintArm = false;
            post("assistant");
            render(false);
            return;
        }
        if (action.startsWith("date:")) {
            long day = Long.parseLong(action.substring(5));
            int[] c = Almanac.civil(day);
            state.selected = day;
            state.card = null;
            state.viewYear = c[0];
            state.viewMonth = c[1];
            render(false);
            return;
        }
        switch (action) {
            case "prev_month":
                shift(-1);
                return;
            case "next_month":
                shift(1);
                return;
            case "prev_year":
                shift(-12);
                return;
            case "next_year":
                shift(12);
                return;
            case "today":
                state.selected = Long.MIN_VALUE;
                state.card = null;
                render(false);
                return; // Page re-selects today
        }
        post(action);
    }
    private void shift(int months) {
        int m = state.viewYear * 12 + state.viewMonth - 1 + months, y = m / 12;
        if (y < Almanac.FIRST_YEAR || y > Almanac.LAST_YEAR)
            return;
        state.viewYear = y;
        state.viewMonth = m % 12 + 1;
        render(false);
    }
    private void armMenu() {
        menuTouched = SystemClock.uptimeMillis();
        ui.removeCallbacks(closeMenu);
        ui.postDelayed(closeMenu, MENU_IDLE_MS + 50);
    }

    // ---------------------------------------------------------------- Home Assistant writes
    /**
     * Sends one write. The screen shows its target as "waiting" (never as confirmed); the outcome comes
     * from /data. Different controls proceed in parallel; a new tap on the same control replaces the
     * old target. POST waits at most 3 s to connect and 5 s for the 202 — nothing blocks other buttons.
     */
    private void post(String action) {
        String endpoint = prefs.getString("endpoint", "");
        String token = prefs.getString("token", "");
        if (endpoint.isEmpty() || !connected || !Json.bool(data, "online")) {
            setNotice("离线，操作未发送");
            return;
        }
        if (requests.modeChanging() && (action.startsWith("temp") || action.startsWith("range"))) {
            setNotice("正在切换空调模式，请稍候");
            return;
        }
        Object shown = requests.overlay(data);
        if (shown == data)
            shown = Json.copy(data);
        Optimistic.apply(shown, action);
        final String wire = Optimistic.wire(shown, action);
        final String id = UUID.randomUUID().toString();
        if (requests.start(wire, id, SystemClock.elapsedRealtime()) == null)
            return; // that target is already on its way
        render(false);
        posts.execute(() -> {
            HttpURLConnection connection = null;
            boolean sent = false;
            long sequence = 0;
            String serverId = null;
            String requestStatus = null;
            String refusalReason = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint + "/action").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(3000);
                connection.setReadTimeout(5000);
                connection.setDoOutput(true);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Authorization", "Bearer " + token);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] body = ("{\"action\":" + Json.quote(wire) + ",\"id\":" + Json.quote(id) + "}").getBytes("UTF-8");
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body);
                }
                sent = true;
                int code = connection.getResponseCode();
                if (code == 202) {
                    Object response = Json.parse(new String(
                        SyncService.readBytes(connection.getInputStream(), 4096, System.currentTimeMillis() + 5000),
                        "UTF-8"));
                    Double sequenceValue = Json.num(response, "seq");
                    sequence = sequenceValue == null ? 0 : sequenceValue.longValue();
                    serverId = Json.str(response, "server");
                    requestStatus = Json.str(response, "status");
                } else {
                    refusalReason = "操作未执行";
                    try {
                        Object response = Json.parse(new String(
                            SyncService.readBytes(connection.getErrorStream(), 4096, System.currentTimeMillis() + 2000),
                            "UTF-8"));
                        String errorMessage = Json.str(response, "error");
                        if (errorMessage != null && code < 500)
                            refusalReason = errorMessage;
                    } catch (Exception ignored) {
                    }
                }
            } catch (Exception failed) { /* sent tells whether the server may have it */
            } finally {
                if (connection != null)
                    connection.disconnect();
            }
            final boolean delivered = sent;
            final long acceptedSeq = sequence;
            final String acceptedServerId = serverId;
            final String acceptedStatus = requestStatus;
            final String responseError = refusalReason;
            ui.post(() -> {
                if (exiting)
                    return;
                if (acceptedSeq > 0)
                    requests.accepted(id, acceptedSeq, acceptedServerId, acceptedStatus);
                else if (responseError != null) {
                    requests.notSent(id);
                    setNotice(responseError);
                } else if (delivered)
                    requests.replyLost(id); // may have been applied: keep checking by id
                else {
                    requests.notSent(id);
                    setNotice("网络不通，操作未发送");
                }
                render(false);
                scheduleReadback(Requests.FAST_MS);
            });
        });
    }
    private void loadIcon() {
        File f = new File(getFilesDir(), "icon.gray");
        if (!f.exists() || f.length() != 128 * 128) {
            icon = null;
            return;
        }
        try (FileInputStream in = new FileInputStream(f)) {
            icon = SyncService.readBytes(in, 128 * 128, Long.MAX_VALUE);
        } catch (IOException unreadable) {
            icon = null;
        }
    }
    /** Downloads GET /image when /data names a new version; HA's picture is cropped, scaled and greyed here. */
    private void fetchIcon() {
        final String version = Json.str(Json.obj(data, "assistant"), "image");
        if (version == null) {
            if (icon != null) {
                icon = null;
                new File(getFilesDir(), "icon.gray").delete();
                prefs.edit().remove("icon_version").apply();
                render(false);
            }
            return;
        }
        if (iconLoading || version.equals(prefs.getString("icon_version", "")) && icon != null)
            return;
        final String endpoint = prefs.getString("endpoint", "");
        final String token = prefs.getString("token", "");
        if (endpoint.isEmpty() || token.isEmpty())
            return;
        iconLoading = true;
        reads.execute(() -> {
            byte[] grayPixels = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint + "/image").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(3000);
                connection.setReadTimeout(10000);
                connection.setRequestProperty("Authorization", "Bearer " + token);
                if (connection.getResponseCode() == 200)
                    grayPixels = grayIcon(SyncService.readBytes(
                        connection.getInputStream(), 2_000_000, System.currentTimeMillis() + 15000));
            } catch (Exception failed) {
                grayPixels = null;
            } finally {
                if (connection != null)
                    connection.disconnect();
            }
            final byte[] downloadedPixels = grayPixels;
            ui.post(() -> {
                iconLoading = false;
                if (exiting || downloadedPixels == null)
                    return;
                try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "icon.gray"))) {
                    out.write(downloadedPixels);
                } catch (IOException ignored) {
                }
                icon = downloadedPixels;
                prefs.edit().putString("icon_version", version).apply();
                render(false);
            });
        });
    }
    /** Centre-crops to a square, scales to 128 x 128 and flattens onto white as 8-bit grey; null if not an image. */
    static byte[] grayIcon(byte[] encoded) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, o);
        if (o.outWidth <= 0 || o.outHeight <= 0)
            return null;
        o.inJustDecodeBounds = false;
        o.inSampleSize = 1;
        while (Math.min(o.outWidth, o.outHeight) / (o.inSampleSize * 2) >= 128)
            o.inSampleSize *= 2; // stay small on a 1 GB device
        Bitmap b = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, o);
        if (b == null)
            return null;
        int side = Math.min(b.getWidth(), b.getHeight());
        Bitmap square = Bitmap.createBitmap(b, (b.getWidth() - side) / 2, (b.getHeight() - side) / 2, side, side);
        Bitmap small = Bitmap.createScaledBitmap(square, 128, 128, true);
        int[] px = new int[128 * 128];
        small.getPixels(px, 0, 128, 0, 0, 128, 128);
        byte[] out = new byte[px.length];
        for (int i = 0; i < px.length; i++) {
            int pixel = px[i];
            int alpha = pixel >>> 24;
            int gray = Ink.rgbToGray(pixel);
            out[i] = (byte) ((gray * alpha + 255 * (255 - alpha)) / 255);
        }
        return out;
    }
    /**
     * Next read-back: fast while a write is inside its budget, slower while unconfirmed, and every
     *  10 s while someone is using the panel (so changes made elsewhere show up); none otherwise.
     */
    private void planReadback() {
        long now = SystemClock.elapsedRealtime(), delay = requests.nextRead(now);
        if (delay < 0 && now < awakeUntil)
            delay = INTERACTIVE_POLL_MS;
        if (delay >= 0)
            scheduleReadback(delay);
    }
    private void scheduleReadback(long delay) {
        ui.removeCallbacks(readback);
        ui.postDelayed(readback, delay);
    }
    /** A short /data read in the display process (3 s connect, 5 s read), separate from the quarter sync. */
    private void readBack() {
        if (exiting || readingBack || !wifi())
            return; // offline: the Wi-Fi broadcast resumes reads

        final String endpoint = prefs.getString("endpoint", "");
        final String token = prefs.getString("token", "");
        if (endpoint.isEmpty() || token.isEmpty())
            return;
        readingBack = true;
        final String etag = new File(getFilesDir(), SyncService.FILE).exists() ? prefs.getString("etag", "") : "";
        final File pendingFile = new File(getFilesDir(), SyncService.FILE + ".readback." + System.nanoTime());
        final long startedAt = System.currentTimeMillis();
        reads.execute(() -> {
            HttpURLConnection connection = null;
            int responseCode = -1;
            long dataTime = 0;
            String etagHeader = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint + "/data").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(3000);
                connection.setReadTimeout(5000);
                connection.setRequestProperty("Authorization", "Bearer " + token);
                if (!etag.isEmpty())
                    connection.setRequestProperty("If-None-Match", etag);
                responseCode = connection.getResponseCode();
                dataTime = SyncService.parseDataTime(connection.getHeaderField("X-Data-Time"));
                etagHeader = connection.getHeaderField("ETag");
                if (responseCode == 200) {
                    byte[] responseBody = SyncService.readBytes(
                        connection.getInputStream(), 2_000_000, System.currentTimeMillis() + 5000);
                    Json.parse(new String(responseBody, "UTF-8"));
                    try (FileOutputStream out = new FileOutputStream(pendingFile)) {
                        out.write(responseBody);
                        out.getFD().sync();
                    }
                }
            } catch (Exception failed) {
                responseCode = -1;
            } finally {
                if (connection != null)
                    connection.disconnect();
            }
            final int statusCode = responseCode;
            final long receivedDataTime = dataTime;
            final String receivedEtag = etagHeader;
            ui.post(() -> {
                readingBack = false;
                if (exiting) {
                    pendingFile.delete();
                    return;
                }
                if (statusCode == 200 && !adopt(pendingFile, receivedEtag, receivedDataTime)) {
                    pendingFile.delete();
                    planReadback();
                    return;
                }
                if (statusCode == 200 || statusCode == 304)
                    reached(startedAt, receivedDataTime);
                else {
                    pendingFile.delete();
                    planReadback();
                } // a missed read-back is retried; it does not mark the panel offline
            });
        });
    }
}
