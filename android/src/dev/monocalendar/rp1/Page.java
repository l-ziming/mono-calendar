package dev.monocalendar.rp1;

import java.util.*;

/**
 * The whole 1650 x 2200 page. Every coordinate below comes from an HTML mock-up of the design; baselines
 * are derived from the fonts' own ascent/descent the same way CSS centres a line box, so text sits where
 * the design has it.
 */
public final class Page {
    public static final int W = 1650, H = 2200;

    // ---------------------------------------------------------------- design tokens
    // Name a role, never a value. The panel shows 16 greys (step 17): text greys sit 4 steps apart, surface greys
    // 2 steps apart, and the two families never meet. Small areas need a darker grey than large ones to read.
    /** Main content, structural rules, the inverse ground of "now" and "needs you". */
    static final int INK = 0x00;
    /** Secondary text: labels, units, meta. */
    static final int INK_2 = 0x44;
    /** Receded: outside the month, unavailable, a missing "—", waiting. */
    static final int INK_3 = 0x88;
    /** Small grey areas: selection, tags, tracks, light rules. */
    static final int TINT = 0xCC;
    /** Large grey areas: weekends, buttons, cards, chart areas. */
    static final int FILL = 0xEE;
    /** Paper, and text on the inverse ground. */
    static final int PAPER = 0xFF;
    /** Data encoding only (AQI, over the limit), never chrome: light to dark, at least 2 steps apart. */
    static final int[] DATA = {0xEE, 0xCC, 0xAA, 0x88, 0x44, 0x00};
    /** Every grey the page may draw; desktop checks reject any other. */
    public static final int[] GREYS = {INK, INK_2, INK_3, DATA[2], TINT, FILL, PAPER};

    // Type: nine sizes, about 1.25x apart up to T_H2 and 1.5x or more for display. Serif sets time and readings,
    // Noto Sans SC sets words, Inter sets UI digits and Latin. At 18 px and below a face steps up to SemiBold.
    static final float T_MICRO = 15, T_CAPTION = 18, T_BODY = 22, T_TITLE = 28, T_H3 = 36, T_H2 = 44, T_H1 = 72,
                       T_DISPLAY = 112, T_HERO = 232;
    /** The hint's opening quote is a glyph, not text, and stays outside the scale. */
    static final float QUOTE_GLYPH = 154;
    /** Every text size the page may use; desktop checks reject any other. */
    public static final float[] TYPE_SCALE = {
        T_MICRO, T_CAPTION, T_BODY, T_TITLE, T_H3, T_H2, T_H1, T_DISPLAY, T_HERO, QUOTE_GLYPH};

    // Rules: BLOCK separates the page's regions and is the "on" bar on top of a control; TITLE sits under a module
    // title and tops each calendar week; ROW separates rows and columns. A light rule is ROW in TINT.
    static final float RULE_BLOCK = 4, RULE_TITLE = 3, RULE_ROW = 2;
    /** Named regions for partial e-ink refreshes. */
    public static final float[][] REGIONS = {{72, 56, 1000, 266}, {1000, 56, 1590, 240},
        {72, 266, 1578, 324}, // date, status+shichen, year progress
        {72, 342, 712, 540}, {72, 575, 712, 770}, {72, 807, 712, 1042}, // schedule, almanac, terms
        {778, 342, 1578, 1042}, // month
        {72, 1074, 1578, 1460}, {72, 1473, 1578, 1625}, {72, 1625, 1578, 1805}, // weather, rooms+AC, air
        {72, 1805, 1578, 2002}, {72, 2034, 1578, 2144}}; // hint, devices

    public static final class Target {
        public final float left, top, right, bottom;
        public final String action;
        Target(float l, float t, float r, float b, String a) {
            left = l;
            top = t;
            right = r;
            bottom = b;
            action = a;
        }
        public boolean contains(float x, float y) {
            return x >= left && x < right && y >= top && y < bottom;
        }
    }
    /** Local, device-only view state. */
    public static final class State {
        public long selected = Long.MIN_VALUE;
        public int viewYear, viewMonth;
        public boolean menu, exitArm;
        /** The hint icon was tapped once: a second tap within 5 s asks the server for new hint text. */
        public boolean hintArm;
        /** An open explanation card: kind 宜/忌/日/冲/煞 covers the almanac, 节 covers the terms list. */
        public String card, cardKind;
    }
    /** Device-local status bar inputs, plus the hint icon the App fetched (128 x 128 grey) or null. */
    public static final class Status {
        public boolean wifi, charging, full;
        public int battery = -1;
        public String warning = "";
        public byte[] icon;
    }

    private final Almanac almanac;
    private Ink ink;
    private final List<Target> targets = new ArrayList<>();
    public Page(Almanac almanac) {
        this.almanac = almanac;
    }

    // ---------------------------------------------------------------- text helpers
    private static boolean cjk(char c) {
        return c >= 0x2e80;
    }
    private static boolean hasCjk(String s) {
        for (int i = 0; i < s.length(); i++)
            if (cjk(s.charAt(i)))
                return true;
        return false;
    }
    private static boolean inter(int f) {
        return f >= Ink.INTER && f <= Ink.INTER_SEMIBOLD || f == Ink.INTER_BOLD;
    }
    private static int fallback(int font) {
        if (font == Ink.INTER) {
            return Ink.SANS;
        }
        if (font == Ink.INTER_MEDIUM) {
            return Ink.SANS_MEDIUM;
        }
        if (font == Ink.INTER_SEMIBOLD) {
            return Ink.SANS_SEMIBOLD;
        }
        return Ink.SANS_BOLD;
    }

    private static int textRunEnd(String text, int start) {
        boolean chinese = cjk(text.charAt(start));
        int end = start;
        while (end < text.length() && cjk(text.charAt(end)) == chinese) {
            end++;
        }
        return end;
    }
    /** Ascent and descent (em) of the face that sets the line box, matching the bundled fonts' hhea tables. */
    private static float[] metrics(int f, String s) {
        if (inter(f) && !hasCjk(s))
            return new float[] {0.96875f, 0.2412f};
        if (f == Ink.SERIF || f == Ink.SERIF_BOLD)
            return new float[] {1.151f, 0.286f};
        if (f == Ink.SERIF_LATIN_BOLD)
            return new float[] {1.069f, 0.293f};
        return new float[] {1.16f, 0.288f};
    }
    /** Baseline of a text line vertically centred in a box, as CSS does. */
    static float base(float top, float height, int f, float size, String s) {
        float[] m = metrics(f, s);
        return top + (height - (m[0] + m[1]) * size) / 2 + m[0] * size;
    }
    float width(String text, int font, float size) {
        if (!inter(font))
            return ink.measure(text, font, size);
        float width = 0;
        int start = 0;
        while (start < text.length()) {
            int end = textRunEnd(text, start);
            int runFont = cjk(text.charAt(start)) ? fallback(font) : font;
            width += ink.measure(text.substring(start, end), runFont, size);
            start = end;
        }
        return width;
    }
    /** Inter text falls back to Noto Sans SC for CJK characters, as the browser does. */
    float text(String text, float x, float baseline, int font, float size, int gray) {
        if (text == null || text.isEmpty())
            return x;
        if (!inter(font)) {
            ink.text(text, x, baseline, font, size, gray);
            return x + ink.measure(text, font, size);
        }
        int start = 0;
        while (start < text.length()) {
            int end = textRunEnd(text, start);
            String run = text.substring(start, end);
            int runFont = cjk(text.charAt(start)) ? fallback(font) : font;
            ink.text(run, x, baseline, runFont, size, gray);
            x += ink.measure(run, runFont, size);
            start = end;
        }
        return x;
    }
    float right(String s, float r, float baseline, int f, float size, int gray) {
        float w = width(s, f, size);
        text(s, r - w, baseline, f, size, gray);
        return r - w;
    }
    void center(String s, float cx, float baseline, int f, float size, int gray) {
        text(s, cx - width(s, f, size) / 2, baseline, f, size, gray);
    }
    /** CSS letter-spacing: each character advances by its width plus the spacing. */
    float tracked(String s, float x, float baseline, int f, float size, int gray, float spacing) {
        for (int i = 0; i < s.length(); i++) {
            String c = s.substring(i, i + 1);
            if (gray >= 0)
                ink.text(c, x, baseline, f, size, gray);
            x += ink.measure(c, f, size) + spacing;
        }
        return x;
    }
    String fit(String s, float max, int f, float size) {
        if (s == null)
            return "";
        if (width(s, f, size) <= max)
            return s;
        while (!s.isEmpty() && width(s + "…", f, size) > max)
            s = s.substring(0, s.length() - 1);
        return s + "…";
    }
    /** Chinese prose wrapped by character (Latin runs kept whole); closing punctuation never starts a line. */
    List<String> prose(String s, float max, int f, float size) {
        List<String> out = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (int i = 0; i < s.length();) {
            int j = i + 1;
            if (!cjk(s.charAt(i)) && s.charAt(i) != ' ')
                while (j < s.length() && !cjk(s.charAt(j)) && s.charAt(j) != ' ')
                    j++;
            String token = s.substring(i, j);
            i = j;
            if (line.length() > 0 && width(line + token, f, size) > max
                && "，。、；：！？」』）".indexOf(token.charAt(0)) < 0) {
                out.add(line.toString().trim());
                line.setLength(0);
                if (token.equals(" "))
                    continue;
            }
            line.append(token);
        }
        if (line.length() > 0)
            out.add(line.toString().trim());
        return out;
    }
    void rect(float l, float t, float r, float b, int g) {
        ink.rect(l, t, r, b, g);
    }
    /** A horizontal rule whose top edge is at top. */
    void hrule(float l, float top, float r, float weight, int gray) {
        rect(l, top, r, top + weight, gray);
    }
    /** A vertical rule whose left edge is at left. */
    void vrule(float left, float t, float b, float weight, int gray) {
        rect(left, t, left + weight, b, gray);
    }
    void icon(String d, float left, float top, float scale, float stroke, int gray) {
        ink.path(Svg.path(d, left, top, scale), -1, stroke * scale, gray, true);
    }
    void target(float l, float t, float r, float b, String action) {
        targets.add(new Target(l, t, r, b, action));
    }
    /** "wait" while a write to this control is on its way, "unconfirmed" once its budget ran out, else null. */
    static String mark(Object data, String key) {
        return Json.str(Json.obj(data, "pending"), key);
    }

    // ---------------------------------------------------------------- formatting
    static String one(Double v) {
        return v == null ? "—" : String.format(Locale.US, "%.1f", v);
    }
    static String whole(Double v) {
        return v == null ? "—" : String.valueOf(Math.round(v));
    }
    static String trim(Double v) {
        if (v == null)
            return "—";
        String s = String.format(Locale.US, "%.1f", v);
        return s.endsWith(".0") ? s.substring(0, s.length() - 2) : s;
    }
    static String milli(Double v) {
        if (v == null)
            return "—";
        String s = String.format(Locale.US, "%.3f", v);
        return s.startsWith("0.") ? s.substring(1) : s;
    }
    static String two(int v) {
        return v < 10 ? "0" + v : String.valueOf(v);
    }
    static String dot(Almanac.Day d) {
        return two(d.month) + "." + two(d.day);
    }

    // ---------------------------------------------------------------- the page
    public List<Target> draw(Ink ink, Object data, State viewState, Status status, long now, TimeZone zone) {
        this.ink = ink;
        targets.clear();
        Calendar calendar = Calendar.getInstance(zone);
        calendar.setTimeInMillis(now);
        long today = Almanac.epochDay(
            calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH));
        if (viewState.selected == Long.MIN_VALUE) {
            viewState.selected = today;
            int[] t = Almanac.civil(today);
            viewState.viewYear = t[0];
            viewState.viewMonth = t[1];
        }
        String clock = two(calendar.get(Calendar.HOUR_OF_DAY)) + ":" + two(calendar.get(Calendar.MINUTE));
        rect(0, 0, W, H, PAPER);
        header(calendar, today, status, viewState);
        schedule(data, viewState.selected, today, clock);
        almanac(viewState, today);
        terms(viewState, today);
        vrule(744, 342, 1042, RULE_ROW, INK);
        month(data, viewState, today);
        weather(data, clock);
        indoor(data);
        air(data, now, zone);
        hint(data, status.icon, viewState.hintArm);
        devices(data);
        if (viewState.menu)
            menu(viewState);
        return new ArrayList<>(targets);
    }

    private void header(Calendar calendar, long today, Status status, State viewState) {
        Almanac.Day day = almanac.day(today);
        String dayText = two(day.day);
        float xm = 72 + tracked(dayText, 72, 249.5f, Ink.SERIF, T_HERO, -1, -6) - 72 + 44;
        tracked(dayText, 72, 249.5f, Ink.SERIF, T_HERO, INK, -6);
        text("星期"
                + "日一二三四五六".charAt(day.weekday()),
            xm, 143.5f, Ink.SERIF_BOLD, T_H1, INK);
        float r2 = 165, r3 = 212;
        text(day.known ? "农历" + day.lunarText() : "", xm, 190, Ink.SANS_BOLD, T_TITLE, INK);
        vrule(xm + 190, r2, r2 + 26, RULE_ROW, INK);
        tracked(day.known ? day.ganzhi() : "", xm + 210, 188.5f, Ink.SANS_MEDIUM, T_BODY, INK, 1);
        text(day.year + " 年 " + day.month + " 月", xm, 231, Ink.INTER_SEMIBOLD, T_BODY, INK);
        vrule(xm + 190, r3, r3 + 22, RULE_ROW, INK);
        int dayOfYear = (int) (today - Almanac.epochDay(day.year, 1, 1)) + 1,
            yearDays = (int) (Almanac.epochDay(day.year + 1, 1, 1) - Almanac.epochDay(day.year, 1, 1));
        float x = xm + 210;
        x = text("第 ", x, 231, Ink.INTER_MEDIUM, T_BODY, INK_2);
        x = text(String.valueOf(day.isoWeek()), x, 231, Ink.INTER_SEMIBOLD, T_BODY, INK);
        x = text(" 周", x, 231, Ink.INTER_MEDIUM, T_BODY, INK_2);
        x += 18;
        x = text("第 ", x, 231, Ink.INTER_MEDIUM, T_BODY, INK_2);
        x = text(String.valueOf(dayOfYear), x, 231, Ink.INTER_SEMIBOLD, T_BODY, INK);
        text(" 天", x, 231, Ink.INTER_MEDIUM, T_BODY, INK_2);

        // Status row: warning, Wi-Fi, divider, battery — right to left, all centred on y = 99.
        String batteryText;
        if (status.full) {
            batteryText = "已充满";
        } else if (status.battery < 0) {
            batteryText = "—";
        } else {
            batteryText = status.battery + "%";
        }
        int batteryFont = status.full ? Ink.SANS_SEMIBOLD : Ink.INTER_SEMIBOLD;
        float batLeft = 1524 - width(batteryText, batteryFont, T_CAPTION);
        text(batteryText, batLeft, 106.3f, batteryFont, T_CAPTION, INK);
        ink.path(roundRect(1535.25f, 89.25f, 1573.75f, 108.75f, 4), -1, 2.5f, INK, false);
        int level = status.full ? 100 : Math.max(0, Math.min(100, status.battery));
        if (level > 0)
            ink.path(
                roundRect(1538.5f, 92.5f, 1538.5f + Math.max(3, 32f * level / 100), 105.5f, 1.5f), INK, 0, -1, false);
        ink.line(1576.5f, 96, 1576.5f, 102, 2.5f, INK, 0, 0);
        if (status.charging) { // plugged in: a bolt slightly taller than the battery, cut out of outline and fill by a
            // white gap
            float[] bolt = Svg.path("M11 0L0 12.6H7.2L5 23.2L17.4 9.4H10.2L12.4 0Z", 1545.8f, 87.4f, 1);
            ink.path(bolt, PAPER, 4.6f, PAPER, true);
            ink.path(bolt, INK, 0, -1, false);
        }
        if (viewState.menu)
            hrule(batLeft - 8, 77, 1586, RULE_BLOCK, INK);
        target(batLeft - 8, 77, 1586, 121, "menu");
        float divider = batLeft - 20;
        vrule(divider, 88, 110, RULE_ROW, INK);
        float wifiLeft = divider - 18 - 32;
        if (status.wifi) {
            for (String p : new String[] {"M2.21 8.21A19.5 19.5 0 0 1 29.79 8.21L26.61 11.39A15 15 0 0 0 5.39 11.39Z",
                     "M7.16 13.16A12.5 12.5 0 0 1 24.84 13.16L21.66 16.34A8 8 0 0 0 10.34 16.34Z",
                     "M16 22L12.11 18.11A5.5 5.5 0 0 1 19.89 18.11Z"})
                ink.path(Svg.path(p, wifiLeft, 87, 1), INK, 1.2f, INK, false);
        } else
            ink.path(Svg.path("M16 22L2.21 8.21A19.5 19.5 0 0 1 29.79 8.21Z", wifiLeft, 87, 1), -1, 1, INK, false);
        if (status.warning != null && !status.warning.isEmpty()) {
            float left = wifiLeft - 18 - (12 + 28 + 8 + width(status.warning, Ink.INTER_MEDIUM, T_CAPTION) + 12);
            rect(left, 83, wifiLeft - 18, 115, INK);
            ink.path(Svg.path("M14 1.5L27 24.5H1Z", left + 12, 86, 1), PAPER, 2, PAPER, true);
            ink.line(left + 26, 94.5f, left + 26, 102.5f, 3.2f, INK, 0, 0);
            ink.circle(left + 26, 106.8f, 1.9f, INK, 0, -1);
            // Warnings can carry server text, so they keep Medium: the only full CJK face besides Regular.
            text(status.warning, left + 48, 107, Ink.INTER_MEDIUM, T_CAPTION, PAPER);
        }
        int hour = calendar.get(Calendar.HOUR_OF_DAY), minute = calendar.get(Calendar.MINUTE), quarter = minute / 15;
        String shichen = ""
            + "子丑寅卯辰巳午未申酉戌亥".charAt((hour + 1) / 2 % 12) + (hour % 2 == 1 ? "初" : "正")
            + new String[] {"初刻", "一刻", "二刻", "三刻"}[quarter];
        right(shichen, 1578, 190.5f, Ink.SERIF_BOLD, T_H1, INK);
        int start = hour * 60 + quarter * 15, end = (start + 15) % 1440;
        right(two(start / 60) + ":" + two(start % 60) + "–" + two(end / 60) + ":" + two(end % 60), 1578, 232.5f,
            Ink.INTER_MEDIUM, T_BODY, INK_2);
        hrule(72, 276, 1578, RULE_BLOCK, INK);
        String progress =
            String.format(Locale.US, "今年已过 %.1f%% 余 %d 天", dayOfYear * 100.0 / yearDays, yearDays - dayOfYear);
        float pl = right(progress, 1578, 310, Ink.INTER_SEMIBOLD, T_CAPTION, INK) - 20;
        rect(72, 296, pl, 308, TINT);
        rect(72, 296, 72 + (pl - 72) * dayOfYear / yearDays, 308, INK);
    }
    static float[] roundRect(float l, float t, float r, float b, float radius) {
        String d = String.format(Locale.US,
            "M%f %fH%fA%f %f 0 0 1 %f %fV%fA%f %f 0 0 1 %f %fH%fA%f %f 0 0 1 %f %fV%fA%f %f 0 0 1 %f %fZ", l + radius,
            t, r - radius, radius, radius, r, t + radius, b - radius, radius, radius, r - radius, b, l + radius, radius,
            radius, l, b - radius, t + radius, radius, radius, l + radius, t);
        return Svg.path(d, 0, 0, 1);
    }
    /** A T_TITLE section title in a 52px row, with optional grey meta text right-aligned at 712. */
    private float title(String name, float top, String meta) {
        text(name, 72, base(top, 52, Ink.SANS_BOLD, T_TITLE, name), Ink.SANS_BOLD, T_TITLE, INK);
        if (meta == null || meta.isEmpty())
            return 712;
        float y = base(top, 52, Ink.INTER_SEMIBOLD, T_CAPTION, meta);
        return right(meta, 712, y, Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
    }
    private String monthDay(long epoch) {
        Almanac.Day d = almanac.day(epoch);
        return d.month + "月" + d.day + "日";
    }

    // ---------------------------------------------------------------- schedule (four rows)
    static final int EV_SLOTS = 4;
    /** One schedule row: kind ev (time, title, extra), or a grey line: head (a later day), more, note. */
    static final class Row {
        final String kind, time, title, extra;
        final boolean on;
        Row(String k, String t, String n, String x, boolean on) {
            kind = k;
            time = t;
            title = n;
            extra = x;
            this.on = on;
        }
    }
    private static boolean timed(String t) {
        return t != null && t.matches("\\d\\d:\\d\\d");
    }
    /** The day's events as rows; today hides finished timed events and marks the running one. */
    private List<Row> dayEvents(List<Object> items, String iso, boolean isToday, String clock) {
        List<Row> out = new ArrayList<>();
        for (Object event : items) {
            if (!iso.equals(Json.str(event, "date")))
                continue;
            String time = Json.str(event, "time"), end = Json.str(event, "end"), until = Json.str(event, "until");
            boolean hasTime = timed(time);
            if (isToday && hasTime && until == null && end != null && end.compareTo(clock) <= 0)
                continue;
            boolean ongoing = isToday && hasTime && time.compareTo(clock) <= 0
                && (until != null || end != null && clock.compareTo(end) < 0);
            String extra = "";
            if (ongoing) {
                extra = "进行中";
            } else if (until != null) {
                extra = "至 " + until.substring(5).replace('-', '.');
            }
            out.add(new Row("ev", hasTime ? time : "全天", Json.str(event, "title"), extra, ongoing));
        }
        return out;
    }
    private void fill(List<Row> rows, List<Row> events) {
        if (events.size() <= EV_SLOTS - rows.size()) {
            rows.addAll(events);
            return;
        }
        int k = EV_SLOTS - rows.size() - 1;
        rows.addAll(events.subList(0, Math.max(0, k)));
        rows.add(new Row("more", "", "另 " + (events.size() - k) + " 项", "", false));
    }
    private void schedule(Object data, long selected, long today, String clock) {
        title("日程", 342, selected == today ? null : monthDay(selected));
        Map<String, Object> schedule = Json.obj(data, "schedule");
        String iso = almanac.day(selected).iso(), status = Json.str(schedule, "status"),
               until = Json.str(schedule, "until");
        List<Object> items = Json.list(schedule, "items");
        List<Row> rows = new ArrayList<>();
        if ("unconfigured".equals(status))
            rows.add(new Row("note", "", "未接入日历", "", false));
        else if ("unavailable".equals(status) || "loading".equals(status))
            rows.add(new Row("note", "", "日程暂不可用", "", false));
        else if (until != null && iso.compareTo(until) > 0)
            rows.add(new Row("note", "", "超出已同步范围", "", false));
        else if (selected != today) {
            List<Row> events = dayEvents(items, iso, false, clock);
            if (events.isEmpty())
                rows.add(new Row("note", "", "无日程", "", false));
            else
                fill(rows, events);
        } else {
            List<Row> events = dayEvents(items, iso, true, clock);
            if (!events.isEmpty())
                fill(rows, events);
            else
                rows.add(new Row("note", "",
                    dayEvents(items, iso, false, clock).isEmpty() ? "今天无日程" : "今天日程已结束", "", false));
            int ahead = 0;
            for (int k = 1; k <= 7 && rows.size() <= EV_SLOTS - 2; k++) {
                Almanac.Day day = almanac.day(today + k);
                List<Row> futureEvents = dayEvents(items, day.iso(), false, clock);
                if (futureEvents.isEmpty())
                    continue;
                ahead++;
                String dayLabel;
                if (k == 1) {
                    dayLabel = "明天";
                } else if (k == 2) {
                    dayLabel = "后天";
                } else {
                    dayLabel = day.month + "月" + day.day + "日";
                }
                String label = dayLabel + " 周"
                    + "日一二三四五六".charAt(day.weekday());
                rows.add(new Row("head", "", label, futureEvents.size() + " 项", false));
                rows.addAll(futureEvents.subList(0, Math.min(futureEvents.size(), EV_SLOTS - rows.size())));
            }
            if (events.isEmpty() && ahead == 0)
                rows.set(0, new Row("note", "", "近 7 天无日程", "", false));
        }
        for (int i = 0; i < EV_SLOTS; i++) {
            float top = 394 + 36 * i;
            Row row = i < rows.size() ? rows.get(i) : null;
            float borderWidth = i == 0 ? RULE_TITLE : RULE_ROW;
            hrule(72, top, 712, borderWidth, i == 0 || row != null ? INK : TINT);
            if (row == null) {
                if (i == EV_SLOTS - 1)
                    hrule(72, top + 34, 712, RULE_ROW, TINT);
                continue;
            }
            float x = 712;
            if (row.on) {
                float w = width(row.extra, Ink.SANS_SEMIBOLD, T_CAPTION) + 16,
                      t = top + borderWidth + (36 - borderWidth - 26) / 2;
                x = 712 - w;
                rect(x, t, 712, t + 26, TINT);
                text(row.extra, x + 8, base(t, 26, Ink.SANS_SEMIBOLD, T_CAPTION, row.extra), Ink.SANS_SEMIBOLD,
                    T_CAPTION, INK_2);
            } else if (!row.extra.isEmpty())
                x = right(row.extra, 712,
                    base(top + borderWidth, 36 - borderWidth, Ink.INTER_SEMIBOLD, T_CAPTION, row.extra),
                    Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
            if (!"ev".equals(row.kind)) {
                text(fit(row.title, x - 12 - 72, Ink.INTER_SEMIBOLD, T_CAPTION), 72,
                    base(top + borderWidth, 36 - borderWidth, Ink.INTER_SEMIBOLD, T_CAPTION, row.title),
                    Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
                continue;
            }
            center(row.time, 122, base(top + borderWidth, 36 - borderWidth, Ink.INTER_MEDIUM, T_BODY, row.time),
                Ink.INTER_MEDIUM, T_BODY, INK);
            text(fit(row.title, x - 12 - 184, Ink.SANS_MEDIUM, T_BODY), 184,
                base(top + borderWidth, 36 - borderWidth, Ink.SANS_MEDIUM, T_BODY, "日"), Ink.SANS_MEDIUM, T_BODY, INK);
        }
    }

    // ---------------------------------------------------------------- almanac, terms and their cards
    /** The card text for a tapped word, from AlmanacNotes; 冲/煞 add the generic concept to the day's own value. */
    static String explain(String kind, String word) {
        String d = null;
        if (word != null && !word.isEmpty())
            switch (kind) {
                case "日":
                    d = AlmanacNotes.JIAN_CHU.get(word.substring(0, 1));
                    break;
                case "冲":
                case "煞":
                    d = AlmanacNotes.CONCEPTS.get(kind);
                    break;
                case "节": {
                    String k = AlmanacNotes.FESTIVALS_ALIASES.get(word);
                    k = k == null ? word : k;
                    d = AlmanacNotes.SOLAR_TERMS.get(k);
                    if (d == null)
                        d = AlmanacNotes.FESTIVALS.get(k);
                    break;
                }
                default: {
                    String k = AlmanacNotes.YI_JI_ALIASES.get(word);
                    d = AlmanacNotes.YI_JI.get(k == null ? word : k);
                }
            }
        return d == null ? "暂无释义。" : d;
    }
    /** Space-separated words flowed into lines of at most max px with a 12px gap. */
    private List<List<String>> flow(String words, float max, int lines) {
        List<List<String>> out = new ArrayList<>();
        if (words == null || words.trim().isEmpty())
            return out;
        List<String> line = new ArrayList<>();
        float used = 0;
        for (String w : words.trim().split("\\s+")) {
            float ww = width(w, Ink.SANS_MEDIUM, T_BODY);
            if (!line.isEmpty() && used + 12 + ww > max) {
                out.add(line);
                if (out.size() == lines)
                    return out;
                line = new ArrayList<>();
                used = 0;
            }
            used += (line.isEmpty() ? 0 : 12) + ww;
            line.add(w);
        }
        if (!line.isEmpty())
            out.add(line);
        return out;
    }
    /** An explanation card over the box top..bottom: tag, word (and when), then the wrapped text. */
    private void card(float top, float bottom, String kind, String word, String when) {
        rect(72, top, 712, bottom, PAPER);
        List<String> lines = prose(explain(kind, word), 528, Ink.SANS_MEDIUM, T_BODY);
        float h = 40 + 12 + 32 * lines.size(), t = top + (bottom - top - h) / 2;
        rect(102, t, 142, t + 40, "宜".equals(kind) ? INK : TINT);
        center(kind, 122, base(t, 40, Ink.SERIF_BOLD, T_BODY, kind), Ink.SERIF_BOLD, T_BODY,
            "宜".equals(kind) ? PAPER : INK);
        text(word, 154, base(t, 40, Ink.SERIF_BOLD, T_TITLE, word), Ink.SERIF_BOLD, T_TITLE, INK);
        if (when != null)
            right(when, 712, base(t, 40, Ink.INTER_SEMIBOLD, T_CAPTION, when), Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
        for (int i = 0; i < lines.size(); i++)
            text(lines.get(i), 184, base(t + 52 + 32 * i, 32, Ink.SANS_MEDIUM, T_BODY, "日"), Ink.SANS_MEDIUM, T_BODY,
                INK);
        target(72, top, 712, bottom, "card:close");
    }
    private void almanac(State viewState, long today) {
        Almanac.Day day = almanac.day(viewState.selected);
        hrule(72, 627, 712, RULE_TITLE, INK);
        if (!day.known) {
            title("黄历", 575, null);
            return;
        }
        String[] meta = {Almanac.JIANCHU.charAt(day.jianchu) + "日", "冲" + Almanac.ZODIAC.charAt(day.chong),
            "煞" + Almanac.SHA.charAt(day.sha)};
        title("黄历", 575, null);
        float x = 712, y = base(575, 52, Ink.INTER_SEMIBOLD, T_CAPTION, "日");
        for (int i = 2; i >= 0; i--) {
            float l = right(meta[i], x, y, Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
            target(l - 5, 575, x + 5, 627, "card:" + meta[i].charAt(i == 0 ? 1 : 0) + ":" + meta[i]);
            x = l - 10;
        }
        if (viewState.selected != today)
            right(monthDay(viewState.selected), x, y, Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
        List<List<String>> yi = flow(day.yi, 528, 2), ji = flow(day.ji, 528, 2);
        float hy = Math.max(40, Math.max(1, yi.size()) * 32), hj = Math.max(40, Math.max(1, ji.size()) * 32),
              top = 630 + (140 - hy - 12 - hj) / 2;
        for (int k = 0; k < 2; k++) {
            List<List<String>> lines = k == 0 ? yi : ji;
            float h = k == 0 ? hy : hj, box = top + (h - 40) / 2;
            String g = k == 0 ? "宜" : "忌";
            rect(102, box, 142, box + 40, k == 0 ? INK : TINT);
            center(g, 122, base(box, 40, Ink.SERIF_BOLD, T_BODY, g), Ink.SERIF_BOLD, T_BODY, k == 0 ? PAPER : INK);
            float lt = top + (h - Math.max(1, lines.size()) * 32) / 2;
            for (int i = 0; i < lines.size(); i++) {
                float wx = 184, y0 = lt + 32 * i;
                for (String w : lines.get(i)) {
                    float ww = width(w, Ink.SANS_MEDIUM, T_BODY), padding = Math.max(6, (44 - ww) / 2);
                    text(w, wx, base(y0, 32, Ink.SANS_MEDIUM, T_BODY, "宜"), Ink.SANS_MEDIUM, T_BODY, INK);
                    target(wx - padding, y0 - 6, wx + ww + padding, y0 + 38, "card:" + g + ":" + w);
                    wx += ww + 12;
                }
            }
            if (lines.isEmpty())
                text("—", 184, base(lt, 32, Ink.SANS_MEDIUM, T_BODY, "宜"), Ink.SANS_MEDIUM, T_BODY, INK_2);
            top += h + 12;
        }
        if (viewState.card != null && !"节".equals(viewState.cardKind))
            card(630, 770, viewState.cardKind, viewState.card, null);
    }
    private void terms(State viewState, long today) {
        title("节令", 807, viewState.selected == today ? null : "自 " + monthDay(viewState.selected) + "起");
        hrule(72, 859, 712, RULE_TITLE, INK);
        List<Almanac.Upcoming> upcoming = almanac.upcoming(viewState.selected, 5);
        String when = null;
        for (int i = 0; i < upcoming.size(); i++) {
            float top = 862 + 36 * i, b = i == 0 ? 0 : RULE_ROW;
            if (i > 0)
                hrule(72, top, 712, RULE_ROW, INK);
            Almanac.Upcoming entry = upcoming.get(i);
            String name = entry.name;
            String countdown;
            if (entry.daysAhead == 1) {
                countdown = "明天";
            } else if (entry.daysAhead == 2) {
                countdown = "后天";
            } else {
                countdown = entry.daysAhead + " 天";
            }
            center(dot(entry.day), 122, base(top + b, 36 - b, Ink.INTER_MEDIUM, T_BODY, "11"), Ink.INTER_MEDIUM, T_BODY,
                INK);
            text(name, 184, base(top + b, 36 - b, Ink.SANS_MEDIUM, T_BODY, name), Ink.SANS_MEDIUM, T_BODY, INK);
            float y = base(top + b, 36 - b, Ink.INTER_SEMIBOLD, T_CAPTION, countdown);
            if (entry.daysAhead <= 2)
                center(countdown, 688, y, Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
            else
                right(countdown, 712, y, Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
            target(72, top - 4, 712, top + 40, "card:节:" + name); // 44 px tall; the later row wins the overlap
            if (name.equals(viewState.card))
                when = dot(entry.day) + "  " + countdown;
        }
        if (viewState.card != null && "节".equals(viewState.cardKind))
            card(862, 1042, "节", viewState.card, when);
    }

    static final String[] MONTH_CN = {
        "", "一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"};
    private void month(Object data, State viewState, long today) {
        float titleBase = base(342, 52, Ink.SANS_BOLD, T_TITLE, "月");
        float x = text(MONTH_CN[viewState.viewMonth], 778, titleBase, Ink.SANS_BOLD, T_TITLE, INK);
        text(String.valueOf(viewState.viewYear), x + 14, titleBase, Ink.INTER_SEMIBOLD, T_CAPTION, INK_2);
        hrule(778, 394, 1578, RULE_TITLE, INK);
        String[][] navigation = {{"prev_year", "1310", "44", "M12 5l-7 7 7 7M20 5l-7 7 7 7"},
            {"prev_month", "1360", "44", "M15 5l-7 7 7 7"}, {"today", "1410", "68", null},
            {"next_month", "1484", "44", "M9 5l7 7-7 7"}, {"next_year", "1534", "44", "M4 5l7 7-7 7M12 5l7 7-7 7"}};
        int[] t = Almanac.civil(today);
        boolean atToday = viewState.selected == today && viewState.viewYear == t[0] && viewState.viewMonth == t[1];
        for (String[] button : navigation) {
            float left = Float.parseFloat(button[1]), buttonWidth = Float.parseFloat(button[2]);
            rect(left, 346, left + buttonWidth, 390, FILL);
            if (button[3] != null)
                icon(button[3], left + 10, 356, 1, 3, INK);
            else {
                center("今天", left + buttonWidth / 2, base(346, 44, Ink.SANS_BOLD, T_CAPTION, "今"), Ink.SANS_BOLD,
                    T_CAPTION, INK);
                if (!atToday)
                    hrule(left, 346, left + buttonWidth, RULE_BLOCK, INK);
            }
            target(left, 346, left + buttonWidth, 390, button[0]);
        }
        int weekStart = Json.num(data, "weekStart") != null && Json.num(data, "weekStart") == 0 ? 0 : 1;
        center("周", 802, base(397, 40, Ink.SANS_SEMIBOLD, T_CAPTION, "周"), Ink.SANS_SEMIBOLD, T_CAPTION, INK_2);
        float colW = (800 - 48 - 42) / 7f;
        for (int i = 0; i < 7; i++) {
            int wd = (weekStart + i) % 7;
            boolean weekend = wd == 0 || wd == 6;
            String h = ""
                + "日一二三四五六".charAt(wd);
            text(h, 832 + i * (colW + 6) + 12, base(397, 40, Ink.SANS_SEMIBOLD, T_CAPTION, h),
                weekend ? Ink.SANS_BOLD : Ink.SANS_SEMIBOLD, T_CAPTION, weekend ? INK : INK_2);
        }
        long first = Almanac.epochDay(viewState.viewYear, viewState.viewMonth, 1);
        int offset = (int) Almanac.mod(almanac.day(first).weekday() - weekStart, 7);
        for (int w = 0; w < 6; w++) {
            float top = 437 + 101 * w;
            long rowStart = first - offset + w * 7;
            long thursday = rowStart + Almanac.mod(4 - almanac.day(rowStart).weekday(), 7);
            boolean current = today >= rowStart && today < rowStart + 7;
            String wk = String.valueOf(almanac.day(thursday).isoWeek());
            center(wk, 802, base(top, 95, Ink.INTER_SEMIBOLD, T_CAPTION, wk), Ink.INTER_SEMIBOLD, T_CAPTION,
                current ? INK : INK_2);
            for (int i = 0; i < 7; i++) {
                Almanac.Day day = almanac.day(rowStart + i);
                float l = 832 + i * (colW + 6), r = l + colW, b = top + 95;
                boolean outsideMonth = day.month != viewState.viewMonth || day.year != viewState.viewYear,
                        isToday = day.epoch == today, selected = day.epoch == viewState.selected && !isToday;
                boolean weekend = day.weekday() == 0 || day.weekday() == 6;
                int background = PAPER;
                if (isToday) {
                    background = INK;
                } else if (selected) {
                    background = TINT;
                } else if (weekend && !outsideMonth) {
                    background = FILL;
                }
                rect(l, top, r, b, background);
                float border = outsideMonth ? RULE_ROW : RULE_TITLE;
                hrule(l, top, r, border, outsideMonth ? TINT : INK);
                if (selected) {
                    hrule(l, top, r, RULE_TITLE, INK);
                    rect(l - 1, top - 1, r + 1, top, INK);
                    rect(l - 1, b, r + 1, b + 1, INK);
                    rect(l - 1, top, l, b, INK);
                    rect(r, top, r + 1, b, INK);
                }
                int foreground = INK;
                if (isToday) {
                    foreground = PAPER;
                } else if (outsideMonth) {
                    foreground = INK_3;
                }
                text(String.valueOf(day.day), l + 12, top + border + 45.5f, Ink.SERIF, T_H3, foreground);
                if (day.known) {
                    if (day.strong && !outsideMonth) {
                        float tx = l + 12, baseline = top + 80, padding = 5;
                        float tw = width(day.label, Ink.SANS_SEMIBOLD, T_CAPTION);
                        // The 18px CJK box spans baseline - 16 to baseline + 2.
                        rect(tx - padding, baseline - 16 - padding, tx + tw + padding, baseline + 2 + padding,
                            selected ? PAPER : TINT);
                        text(day.label, tx, baseline, Ink.SANS_SEMIBOLD, T_CAPTION, INK);
                    } else
                        text(day.label, l + 12, top + 80, Ink.SANS_SEMIBOLD, T_CAPTION, foreground);
                }
                target(l, top, r, b, "date:" + day.epoch);
            }
        }
    }

    // ---------------------------------------------------------------- weather
    static final String CLOUD35 = "M12 35h21.5a6.5 6.5 0 0 0 0-13 9.5 9.5 0 0 0-18.3-2.4A7.8 7.8 0 0 0 12 35z";
    static final String CLOUD29 = "M12 29h21.5a6.5 6.5 0 0 0 0-13 9.5 9.5 0 0 0-18.3-2.4A7.8 7.8 0 0 0 12 29z";
    /** Line icons on the design's 48-unit grid; the cloud, rain and sleet shapes are the design's own. */
    static String[] weatherIcon(String condition, boolean night) {
        if (condition == null)
            return new String[0];
        if (night && "sunny".equals(condition))
            condition = "clear-night";
        switch (condition) {
            case "sunny":
                return new String[] {"M24 16a8 8 0 1 0 0.01 0z",
                    "M24 4v5M24 39v5M4 24h5M39 24h5M9.86 9.86l3.54 3.54M34.6 34.6l3.54 3.54M9.86 38.14l3.54-3.54M34.6 13.4l3.54-3.54"};
            case "clear-night":
                return new String[] {"M31 8.5A16 16 0 1 0 39.5 31 12.5 12.5 0 0 1 31 8.5z"};
            case "partlycloudy": {
                String[] light = weatherIcon(night ? "clear-night" : "sunny", night);
                String[] paths = Arrays.copyOf(light, light.length + 1);
                paths[light.length] = CLOUD35;
                return paths;
            }
            case "cloudy":
                return new String[] {CLOUD35};
            case "fog":
                return new String[] {CLOUD29, "M10 35h28M14 41h20"};
            case "rainy":
            case "pouring":
                return new String[] {
                    CLOUD29, "M17 34l-1.5 4M24 34l-1.5 4M31 34l-1.5 4M20.5 40.5l-1 2.5M27.5 40.5l-1 2.5"};
            case "snowy":
                return new String[] {CLOUD29, "M17 33.5v9M13.1 35.75l7.8 4.5M13.1 40.25l7.8-4.5",
                    "M31 33.5v9M27.1 35.75l7.8 4.5M27.1 40.25l7.8-4.5"};
            case "snowy-rainy":
                return new String[] {CLOUD29, "M14.5 34l-1.8 4.5M35 34l-1.8 4.5",
                    "M24 33.5v11M19.24 36.25l9.52 5.5M19.24 41.75l9.52-5.5"};
            case "hail":
                return new String[] {
                    CLOUD29, "M17 36a1.5 1.5 0 1 0 0.01 0zM24 40a1.5 1.5 0 1 0 0.01 0zM31 36a1.5 1.5 0 1 0 0.01 0z"};
            case "lightning":
            case "lightning-rainy":
                return new String[] {CLOUD29, "M25 31l-5 7h7l-4 7"};
            case "windy":
            case "windy-variant":
                return new String[] {"M6 18h22a5 5 0 1 0-5-5", "M6 26h32a5 5 0 1 1-5 5", "M6 34h16"};
            default:
                return new String[] {"M24 6a18 18 0 1 0 0.01 0z", "M24 15v12M24 33v1"};
        }
    }
    static String conditionName(String c) {
        if (c == null)
            return "—";
        switch (c) {
            case "sunny":
            case "clear-night":
                return "晴";
            case "partlycloudy":
                return "晴间多云";
            case "cloudy":
                return "阴";
            case "fog":
                return "雾";
            case "rainy":
                return "雨";
            case "pouring":
                return "大雨";
            case "snowy":
                return "雪";
            case "snowy-rainy":
                return "雨夹雪";
            case "hail":
                return "冰雹";
            case "lightning":
                return "雷电";
            case "lightning-rainy":
                return "雷阵雨";
            case "windy":
            case "windy-variant":
                return "大风";
            case "exceptional":
                return "异常天气";
            default:
                return "—";
        }
    }
    static boolean nightAt(String time, String rise, String set) {
        return time != null && rise != null && set != null && (time.compareTo(rise) < 0 || time.compareTo(set) >= 0);
    }
    void weatherGlyph(String condition, float left, float top, float size, float stroke, boolean night) {
        String[] paths = weatherIcon(condition, night);
        float unit = size / 48f;
        if ("partlycloudy".equals(condition)) {
            for (int i = 0; i < paths.length - 1; i++)
                ink.path(Svg.path(paths[i], left, top - unit, unit * 0.7f), -1, stroke * unit, INK, true);
            // The foreground cloud masks the lower rays/crescent instead of making the sky look overcast.
            ink.path(Svg.path(CLOUD35, left, top, unit), PAPER, stroke * unit, INK, true);
            return;
        }
        for (String p : paths)
            icon(p, left, top, unit, stroke, INK);
    }
    static final String[] AQI_NAMES = {"优", "良", "轻度污染", "中度污染", "重度污染", "严重污染"};
    static final int[] AQI_BG = DATA;

    private static int aqiLevel(double value) {
        if (value <= 50)
            return 0;
        if (value <= 100)
            return 1;
        if (value <= 150)
            return 2;
        if (value <= 200)
            return 3;
        if (value <= 300)
            return 4;
        return 5;
    }
    /** China's Beaufort names; limits are the lower bounds of forces 1-12 in m/s. */
    static final double[] BEAUFORT = {0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7};
    static final String[] WIND_NAMES = {
        "无风", "软风", "轻风", "微风", "和风", "清劲风", "强风", "疾风", "大风", "烈风", "狂风", "暴风", "飓风"};
    static String windName(double ms) {
        int f = 0;
        while (f < BEAUFORT.length && ms >= BEAUFORT[f])
            f++;
        return WIND_NAMES[f];
    }
    /** Hours with a lower chance of precipitation leave the row blank, as the design shows. */
    static final double POP_SHOWN = 30;

    private void weather(Object data, String nowClock) {
        Map<String, Object> weather = Json.obj(data, "weather");
        String sunrise = Json.str(weather, "sunrise"), sunset = Json.str(weather, "sunset");
        hrule(72, 1074, 1578, RULE_BLOCK, INK);
        text("天气", 72, base(1078, 52, Ink.SANS_BOLD, T_TITLE, "天"), Ink.SANS_BOLD, T_TITLE, INK);
        String city = Json.str(data, "city");
        if (city != null)
            text(city, 142, base(1078, 52, Ink.SANS_SEMIBOLD, T_CAPTION, city), Ink.SANS_SEMIBOLD, T_CAPTION, INK_2);
        float tx = tracked(one(Json.num(weather, "temp")), 72, 1249.5f, Ink.SERIF, T_DISPLAY, INK, -4);
        text("°C", tx + 8, 1196.5f, Ink.SERIF, T_H3, INK);
        Double humidity = Json.num(weather, "humidity");
        float hl =
            right(humidity == null ? "—" : whole(humidity) + "%", 512, 1249.5f, Ink.INTER_SEMIBOLD, T_TITLE, INK);
        right("湿度", hl - 8, 1249.5f, Ink.SANS_SEMIBOLD, T_CAPTION, INK_2);
        String condition = Json.str(weather, "condition");
        weatherGlyph(condition, 72, 1279, 48, 1.8f, nightAt(nowClock, sunrise, sunset));
        text(conditionName(condition), 134, base(1279, 48, Ink.SANS_BOLD, T_H3, "多"), Ink.SANS_BOLD, T_H3, INK);
        Double aqi = Json.num(weather, "aqi");
        float vr = 512;
        if (aqi != null) {
            int level = aqiLevel(aqi);
            rect(436, 1290, 512, 1316, AQI_BG[level]);
            center(AQI_NAMES[level], 474, base(1290, 26, Ink.SANS_SEMIBOLD, T_MICRO, "优"), Ink.SANS_SEMIBOLD, T_MICRO,
                level >= 3 ? PAPER : INK);
            vr = 422;
        }
        float al = right(aqi == null ? "—" : whole(aqi), vr, 1312.25f, Ink.INTER_SEMIBOLD, T_TITLE, INK);
        right("AQI", al - 6, 1310, Ink.SANS_SEMIBOLD, T_MICRO, INK_2);
        hrule(72, 1356, 512, RULE_ROW, INK);
        String[] labels = {"日出", "日落", "明天"};
        float[] cols = {72, 218.67f, 365.33f};
        for (int i = 0; i < 3; i++)
            text(labels[i], cols[i], 1399, Ink.SANS_SEMIBOLD, T_CAPTION, INK_2);
        text(sunrise == null ? "—" : sunrise, 72, 1433, Ink.INTER_SEMIBOLD, T_TITLE, INK);
        text(sunset == null ? "—" : sunset, 218.67f, 1433, Ink.INTER_SEMIBOLD, T_TITLE, INK);
        Map<String, Object> tomorrow = Json.obj(weather, "tomorrow");
        if (Json.num(tomorrow, "low") != null || Json.num(tomorrow, "high") != null) {
            weatherGlyph(Json.str(tomorrow, "condition"), 365.33f, 1408, 38, 2.2f, false);
            float x = text(whole(Json.num(tomorrow, "low")) + "～" + whole(Json.num(tomorrow, "high")), 413.33f,
                1438.25f, Ink.INTER_SEMIBOLD, T_TITLE, INK);
            text(" °C", x, 1438.25f, Ink.INTER_SEMIBOLD, T_CAPTION, INK);
        } else
            text("—", 365.33f, 1433, Ink.INTER_SEMIBOLD, T_TITLE, INK);

        // Six hours: time, icon, the 1000 x 140 temperature chart at y 1218, chance of rain, wind arrow and force.
        List<Object> hourly = Json.list(weather, "hourly");
        int hourCount = Math.min(6, hourly.size());
        float columnWidth = 1000 / 6f, chartTop = 1218;
        Double maximumTemp = null, minimumTemp = null;
        for (int i = 0; i < hourCount; i++) {
            Double temperature = Json.num(hourly.get(i), "temp");
            if (temperature == null)
                continue;
            maximumTemp = maximumTemp == null ? temperature : Math.max(maximumTemp, temperature);
            minimumTemp = minimumTemp == null ? temperature : Math.min(minimumTemp, temperature);
        }
        float scale = maximumTemp == null || maximumTemp.equals(minimumTemp)
            ? 7
            : (float) Math.min(7, 84 / (maximumTemp - minimumTemp));
        float[] pointX = new float[hourCount], pointY = new float[hourCount];
        boolean[] hasTemperature = new boolean[hourCount];
        for (int i = 0; i < hourCount; i++) {
            Object hour = hourly.get(i);
            float cx = 578 + columnWidth * i + columnWidth / 2;
            String time = Json.str(hour, "time");
            if (time != null)
                center(time, cx, 1149.5f, Ink.INTER_SEMIBOLD, T_CAPTION, INK);
            weatherGlyph(Json.str(hour, "condition"), cx - 24, 1164, 48, 1.8f, nightAt(time, sunrise, sunset));
            Double temperature = Json.num(hour, "temp");
            if (temperature != null) {
                pointX[i] = cx;
                pointY[i] = chartTop + 44 + (float) (maximumTemp - temperature) * scale;
                hasTemperature[i] = true;
            }
            Double precipitationChance = Json.num(hour, "pop");
            if (precipitationChance != null && precipitationChance >= POP_SHOWN)
                center(Math.round(Math.min(100, precipitationChance)) + "%", cx, 1381.5f, Ink.INTER_SEMIBOLD, T_CAPTION,
                    INK);
            Double windSpeed = Json.num(hour, "wind"), windBearing = Json.num(hour, "bearing");
            if (windBearing != null) { // the arrow points where the wind blows to
                ink.turn((float) (windBearing + 180), cx, 1402);
                icon("M12 20V5M6 10l6-6 6 6", cx - 12, 1390, 1, 2.2f, INK);
                ink.unturn();
            }
            if (windSpeed != null)
                center(windName(windSpeed), cx, 1441, Ink.SANS_SEMIBOLD, T_CAPTION, INK);
        }
        // Area, axis, line, hollow points and labels.
        List<float[]> segmentPoints = new ArrayList<>();
        for (int i = 0; i <= hourCount; i++) {
            if (i < hourCount && hasTemperature[i]) {
                segmentPoints.add(new float[] {pointX[i], pointY[i]});
                continue;
            }
            if (segmentPoints.size() > 1) {
                float[] area = new float[segmentPoints.size() * 3 + 7];
                int k = 0;
                for (int j = 0; j < segmentPoints.size(); j++) {
                    area[k++] = j == 0 ? Ink.MOVE : Ink.LINE;
                    area[k++] = segmentPoints.get(j)[0];
                    area[k++] = segmentPoints.get(j)[1];
                }
                area[k++] = Ink.LINE;
                area[k++] = segmentPoints.get(segmentPoints.size() - 1)[0];
                area[k++] = chartTop + 138;
                area[k++] = Ink.LINE;
                area[k++] = segmentPoints.get(0)[0];
                area[k++] = chartTop + 138;
                area[k] = Ink.CLOSE;
                ink.path(area, FILL, 0, -1, false);
            }
            segmentPoints.clear();
        }
        hrule(578, chartTop + 138, 1578, RULE_ROW, INK);
        for (int i = 0; i + 1 < hourCount; i++)
            if (hasTemperature[i] && hasTemperature[i + 1])
                ink.line(pointX[i], pointY[i], pointX[i + 1], pointY[i + 1], 4, INK, 0, 0);
        for (int i = 0; i < hourCount; i++)
            if (hasTemperature[i]) {
                ink.circle(pointX[i], pointY[i], 6, PAPER, 3, INK);
                center(
                    whole(Json.num(hourly.get(i), "temp")) + "°", pointX[i], pointY[i] - 12, Ink.SERIF, T_TITLE, INK);
            }
    }

    // ---------------------------------------------------------------- indoor
    static final String MINUS = "M5 12h14", PLUS = "M5 12h14M12 5v14";
    private void rooms(Object data) {
        boolean configured = data instanceof Map && ((Map<?, ?>) data).get("rooms") instanceof List;
        List<Object> rooms = Json.list(data, "rooms");
        int count = Math.min(6, configured ? rooms.size() : 2), columns = count <= 3 ? count : count == 4 ? 2 : 3,
            rows = count <= 3 ? 1 : 2;
        if (count == 2)
            vrule(574, 1477, 1625, RULE_ROW, INK);
        else if (count > 2) {
            for (int column = 1; column < columns; column++)
                vrule(72 + column * 903.6f / columns, 1477, 1625, RULE_ROW, INK);
            if (rows == 2)
                hrule(72, 1551, 975.6f, RULE_ROW, INK);
        }
        for (int i = 0; i < count; i++) {
            Object room = configured ? rooms.get(i) : Json.obj(Json.obj(data, "indoor"), i == 0 ? "living" : "bedroom");
            String name = configured ? Json.str(room, "name") : i == 0 ? "客厅" : "卧室";
            Double temperature = Json.num(room, "temp"), humidity = Json.num(room, "humidity");
            String reading = temperature == null ? "—" : one(temperature) + "°",
                   moisture = "湿度 " + (humidity == null ? "—" : trim(humidity) + "%");
            if (count <= 2) {
                float left = i == 0 ? 72 : 596, right = count == 1 ? 975.6f : i == 0 ? 574 : 975.6f;
                text(fit(name, right - left - 18, Ink.SANS_MEDIUM, T_TITLE), left, 1511.25f,
                    Ink.SANS_MEDIUM, T_TITLE, INK);
                float x = text(fit(reading, right - left - 180, Ink.SERIF, T_H1), left, 1606.25f, Ink.SERIF, T_H1, INK);
                text(fit(moisture, right - x - 28, Ink.INTER_MEDIUM, T_BODY), x + 18, 1606.25f,
                    Ink.INTER_MEDIUM, T_BODY, INK);
            } else {
                int column = i % columns;
                float left = 72 + column * 903.6f / columns + (column == 0 ? 0 : 16),
                      right = 72 + (column + 1) * 903.6f / columns - 16, top = 1477 + (i / columns) * 74;
                float nameSize = rows == 1 ? T_TITLE : T_BODY;
                text(fit(name, right - left, Ink.SANS_MEDIUM, nameSize), left, top + (rows == 1 ? 34.25f : 24),
                    Ink.SANS_MEDIUM, nameSize, INK);
                if (rows == 1) {
                    text(fit(reading, right - left, Ink.SERIF, T_H2), left, 1575, Ink.SERIF, T_H2, INK);
                    text(fit(moisture, right - left, Ink.INTER_MEDIUM, T_CAPTION), left, 1606.25f,
                        Ink.INTER_MEDIUM, T_CAPTION, INK);
                } else {
                    float humidityWidth = Math.min((right - left) / 2, width(moisture, Ink.INTER_MEDIUM, T_CAPTION));
                    text(fit(reading, right - left - humidityWidth - 12, Ink.SERIF, T_H3), left, top + 63,
                        Ink.SERIF, T_H3, INK);
                    right(fit(moisture, humidityWidth, Ink.INTER_MEDIUM, T_CAPTION), right, top + 63,
                        Ink.INTER_MEDIUM, T_CAPTION, INK);
                }
            }
        }
    }
    private void indoor(Object data) {
        hrule(72, 1473, 1578, RULE_BLOCK, INK);
        vrule(975.6f, 1477, 1625, RULE_ROW, INK);
        rooms(data);
        Map<String, Object> climate = Json.obj(data, "ac");
        boolean climateAvailable = Json.bool(climate, "available");
        String mode = Json.str(climate, "mode"), hvacAction = Json.str(climate, "action");
        List<Object> modes = Json.list(climate, "modes");
        text("空调", 997.6f, 1523.25f, Ink.SANS_MEDIUM, T_TITLE, INK);
        String[][] modeButtons = {{"heat", "制热"}, {"cool", "制冷"}, {"heat_cool", "区间"}, {"off", "停机"}};
        for (int i = 0; i < 4; i++) {
            float l = 1342 + 60 * i;
            boolean selectedMode = modeButtons[i][0].equals(mode),
                    modeAvailable = climateAvailable && modes.contains(modeButtons[i][0]);
            rect(l, 1490, l + 56, 1534, FILL);
            if (selectedMode)
                hrule(l, 1490, l + 56, RULE_BLOCK, INK);
            int buttonColor = INK_3;
            if (selectedMode) {
                buttonColor = INK;
            } else if (modeAvailable) {
                buttonColor = INK_2;
            }
            center(modeButtons[i][1], l + 28, base(1490, 44, Ink.SANS_SEMIBOLD, T_CAPTION, "制"),
                selectedMode ? Ink.SANS_BOLD : Ink.SANS_SEMIBOLD, T_CAPTION, buttonColor);
            if (modeAvailable && !selectedMode)
                target(l, 1490, l + 56, 1534, "mode:" + modeButtons[i][0]);
        }
        String pendingMark = mark(data, "climate");
        String statusText = null;
        if (pendingMark != null) {
            if ("wait".equals(pendingMark)) {
                statusText = "等待确认";
            } else {
                statusText = "未确认";
            }
        } else if ("heating".equals(hvacAction)) {
            statusText = "正在制热";
        } else if ("cooling".equals(hvacAction)) {
            statusText = "正在制冷";
        } else if ("heat_cool".equals(mode) && hvacAction != null && !"idle".equals(hvacAction)
            && !"off".equals(hvacAction)) {
            statusText = "正在调温";
        }
        if (climateAvailable && statusText != null && (pendingMark != null || !"off".equals(mode))) {
            float statusWidth = width(statusText, Ink.SANS_SEMIBOLD, T_MICRO);
            rect(1021.6f - statusWidth / 2 - 8, 1477, 1021.6f + statusWidth / 2 + 8, 1497, TINT);
            center(statusText, 1021.6f, base(1477, 20, Ink.SANS_SEMIBOLD, T_MICRO, statusText), Ink.SANS_SEMIBOLD,
                T_MICRO, INK_2);
        }
        if (!climateAvailable || mode == null) {
            text("—", 997.6f, 1607, Ink.SERIF, T_H1, INK_3);
            return;
        }
        boolean missingTarget;
        if ("heat_cool".equals(mode)) {
            missingTarget = Json.num(climate, "low") == null || Json.num(climate, "high") == null;
        } else {
            missingTarget = !"off".equals(mode) && Json.num(climate, "target") == null;
        }
        if (missingTarget) {
            text("—", 997.6f, 1607, Ink.SERIF, T_H1, INK_3);
            return;
        }
        if ("heat_cool".equals(mode)) {
            float baseline = base(1540, 72, Ink.SERIF, T_H2, "1"), buttonsTop = 1554;
            String lowText = one(Json.num(climate, "low")) + "°", highText = one(Json.num(climate, "high")) + "°";
            float x = 997.6f;
            rect(x, buttonsTop, x + 44, buttonsTop + 44, FILL);
            icon(MINUS, x + 13, buttonsTop + 13, 0.75f, 2.4f, INK);
            target(x, buttonsTop, x + 44, buttonsTop + 44, "range_low_down");
            x = text(lowText, x + 48, baseline, Ink.SERIF, T_H2, INK) + 4;
            rect(x, buttonsTop, x + 44, buttonsTop + 44, FILL);
            icon(PLUS, x + 13, buttonsTop + 13, 0.75f, 2.4f, INK);
            target(x, buttonsTop, x + 44, buttonsTop + 44, "range_low_up");
            float lowRight = x + 44, highWidth = width(highText, Ink.SERIF, T_H2),
                  highLeft = 1578 - 44 - 4 - highWidth - 4 - 44;
            rect(highLeft, buttonsTop, highLeft + 44, buttonsTop + 44, FILL);
            icon(MINUS, highLeft + 13, buttonsTop + 13, 0.75f, 2.4f, INK);
            target(highLeft, buttonsTop, highLeft + 44, buttonsTop + 44, "range_high_down");
            text(highText, highLeft + 48, baseline, Ink.SERIF, T_H2, INK);
            rect(1534, buttonsTop, 1578, buttonsTop + 44, FILL);
            icon(PLUS, 1547, buttonsTop + 13, 0.75f, 2.4f, INK);
            target(1534, buttonsTop, 1578, buttonsTop + 44, "range_high_up");
            center("～", (lowRight + highLeft) / 2, base(1540, 72, Ink.SANS_MEDIUM, T_H3, "～"), Ink.SANS_MEDIUM, T_H3,
                INK_3);
        } else if ("off".equals(mode))
            text("—", 997.6f, 1607, Ink.SERIF, T_H1, INK_3);
        else {
            text(one(Json.num(climate, "target")) + "°", 997.6f, 1607, Ink.SERIF, T_H1, INK);
            rect(1466, 1556, 1518, 1608, FILL);
            icon(MINUS, 1480, 1570, 1, 2.4f, INK);
            target(1466, 1556, 1518, 1608, "temp_down");
            rect(1526, 1556, 1578, 1608, FILL);
            icon(PLUS, 1540, 1570, 1, 2.4f, INK);
            target(1526, 1556, 1578, 1608, "temp_up");
        }
    }

    private void air(Object data, long now, TimeZone zone) {
        Map<String, Object> indoor = Json.obj(data, "indoor");
        hrule(72, 1625, 1578, RULE_ROW, INK);
        // CO2: value, grade and the 24 hour trend (330 x 88 at 222, 1653; curve 18-324, 400-2000 ppm over 84 px).
        text("CO₂", 72, 1658.5f, Ink.INTER_SEMIBOLD, T_CAPTION, INK);
        Double co2 = Json.num(indoor, "co2");
        float x = text(whole(co2), 72, 1712, Ink.SERIF, T_H2, INK);
        text("ppm", x + 8, 1712, Ink.INTER_SEMIBOLD, T_MICRO, INK);
        if (co2 != null) {
            String co2Grade = "良好";
            if (co2 > 1500) {
                co2Grade = "超标";
            } else if (co2 > 1000) {
                co2Grade = "偏高";
            }
            if (co2 > 1500) {
                float w = width(co2Grade, Ink.INTER_SEMIBOLD, T_MICRO);
                rect(72, 1753, 72 + w + 12, 1771, INK);
                text(co2Grade, 78, 1767.5f, Ink.INTER_SEMIBOLD, T_MICRO, PAPER);
            } else
                text(co2Grade, 72, 1767.5f, Ink.INTER_SEMIBOLD, T_MICRO, co2 > 1000 ? INK : INK_2);
        }
        float chartLeft = 222, chartTop = 1653;
        List<Object> co2History = Json.list(indoor, "co2History");
        int sampleCount = co2History.size();
        float[] sampleX = new float[sampleCount], sampleY = new float[sampleCount];
        boolean[] hasSample = new boolean[sampleCount];
        for (int i = 0; i < sampleCount; i++) {
            Object value = co2History.get(i);
            if (!(value instanceof Double))
                continue;
            double ppm = (Double) value;
            sampleX[i] = chartLeft + 18 + (sampleCount == 1 ? 306 : 306f * i / (sampleCount - 1));
            sampleY[i] = chartTop + (float) Math.max(2, Math.min(87, 88 - (ppm - 400) / 1600 * 84 - 2));
            hasSample[i] = true;
        }
        List<float[]> segments = new ArrayList<>();
        for (int i = 0; i < sampleCount;) {
            if (!hasSample[i]) {
                i++;
                continue;
            }
            int j = i;
            while (j < sampleCount && hasSample[j])
                j++;
            segments.add(new float[] {i, j});
            i = j;
        }
        for (float[] segment : segments) {
            int startIndex = (int) segment[0], endIndex = (int) segment[1];
            if (endIndex - startIndex < 2)
                continue;
            float[] area = new float[(endIndex - startIndex) * 3 + 7];
            int k = 0;
            for (int i = startIndex; i < endIndex; i++) {
                area[k++] = i == startIndex ? Ink.MOVE : Ink.LINE;
                area[k++] = sampleX[i];
                area[k++] = sampleY[i];
            }
            area[k++] = Ink.LINE;
            area[k++] = sampleX[endIndex - 1];
            area[k++] = chartTop + 87;
            area[k++] = Ink.LINE;
            area[k++] = sampleX[startIndex];
            area[k++] = chartTop + 87;
            area[k] = Ink.CLOSE;
            ink.path(area, FILL, 0, -1, false);
            ink.clip(chartLeft, chartTop, chartLeft + 330, chartTop + 54.5f);
            ink.path(area, DATA[2], 0, -1, false); // over the 1000 ppm line
            ink.unclip();
        }
        ink.line(chartLeft + 18, chartTop + 54.5f, chartLeft + 324, chartTop + 54.5f, 2, INK, 6, 5);
        // The 1000 ppm label reads upward beside the dashed line (SVG rotate(-90), dominant-baseline central).
        ink.turn(-90, chartLeft + 8, chartTop + 54.5f);
        center("1000", chartLeft + 8, chartTop + 54.5f + (0.96875f - 0.2412f) / 2 * T_MICRO, Ink.INTER_SEMIBOLD,
            T_MICRO, INK_2);
        ink.unturn();
        hrule(chartLeft + 18, chartTop + 86, chartLeft + 324, RULE_ROW, INK);
        for (float[] segment : segments) {
            int startIndex = (int) segment[0], endIndex = (int) segment[1];
            for (int i = startIndex; i + 1 < endIndex; i++)
                ink.line(sampleX[i], sampleY[i], sampleX[i + 1], sampleY[i + 1], 2, INK, 0, 0);
        }
        if (sampleCount > 0 && hasSample[sampleCount - 1])
            ink.circle(chartLeft + 324, sampleY[sampleCount - 1], 5, INK, 0, -1);
        Double historyEnd = Json.num(indoor, "co2End");
        long end = historyEnd == null ? now : historyEnd.longValue(), start = end - 86400000L;
        Calendar cal = Calendar.getInstance(zone);
        float tickY = 1761.5f;
        for (int h = 0; h < 26; h++) {
            cal.setTimeInMillis(start);
            cal.set(Calendar.MINUTE, 0);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            cal.add(Calendar.HOUR_OF_DAY, h);
            long t = cal.getTimeInMillis();
            int hour = cal.get(Calendar.HOUR_OF_DAY);
            if (t <= start || t >= end || hour % 6 != 0)
                continue;
            float tx = 18 + 306f * (t - start) / 86400000f;
            if (tx > 324 - 34 || tx < 28)
                continue;
            center(two(hour), chartLeft + tx, tickY, Ink.INTER_SEMIBOLD, T_MICRO, INK_2);
        }
        center("现在", chartLeft + 324, tickY, Ink.INTER_SEMIBOLD, T_MICRO, INK_2);
        // Five particulate/gas columns: value, scale bar (safe zone, limit line, diamond) and grade.
        String[][] pollutants = {{"PM2.5", "pm25", "50", "µg/m³", "50"}, {"PM10", "pm10", "100", "µg/m³", "100"},
            {"PM1", "pm1", "15", "µg/m³", "15"}, {"甲醛", "hcho", "0.08", "mg/m³", "0.08"},
            {"TVOC", "tvoc", "0.6", "mg/m³", "0.60"}};
        for (int i = 0; i < 5; i++) {
            float colL = 574 + 200.8f * i, l = colL + 22, w = i == 4 ? 178.8f : 158.8f;
            vrule(colL, 1627, 1805, RULE_ROW, INK);
            text(pollutants[i][0], l, 1658.5f, Ink.INTER_SEMIBOLD, T_CAPTION, INK);
            Double pollutantValue = Json.num(indoor, pollutants[i][1]);
            double limit = Double.parseDouble(pollutants[i][2]);
            String valueText = i < 3 ? whole(pollutantValue) : milli(pollutantValue);
            float vx = text(valueText, l, 1712, Ink.SERIF, T_H2, INK);
            text(pollutants[i][3], vx + 8, 1712, Ink.INTER_SEMIBOLD, T_MICRO, INK);
            float lim = l + w * 0.667f;
            rect(l, 1731, lim, 1739, TINT);
            hrule(l, 1739, l + w, RULE_ROW, INK);
            vrule(lim, 1727, 1739, RULE_ROW, INK);
            center(pollutants[i][4], lim + 1, 1757, Ink.INTER_SEMIBOLD, T_MICRO, INK_2);
            if (pollutantValue != null) {
                float pos = l + w * (float) Math.min(1, Math.max(0, pollutantValue / (limit * 1.5)));
                ink.path(new float[] {Ink.MOVE, pos, 1732.93f, Ink.LINE, pos + 7.07f, 1740, Ink.LINE, pos, 1747.07f,
                             Ink.LINE, pos - 7.07f, 1740, Ink.CLOSE},
                    INK, 0, -1, false);
                String grade;
                if (pollutantValue <= limit / 2) {
                    grade = "优";
                } else if (pollutantValue <= limit) {
                    grade = "良";
                } else {
                    grade = "超标";
                }
                text(grade, l, 1767.5f, Ink.INTER_SEMIBOLD, T_MICRO, pollutantValue > limit ? INK : INK_2);
            }
        }
    }

    /** Up to four hint lines beside a quote mark, or beside the 128 x 128 icon the App fetched from HA. */
    private void hint(Object data, byte[] icon, boolean armed) {
        hrule(72, 1805, 1578, RULE_BLOCK, INK);
        List<String> lines = new ArrayList<>();
        for (Object o : Json.list(Json.obj(data, "assistant"), "lines"))
            if (o instanceof String && !((String) o).trim().isEmpty() && lines.size() < 4)
                lines.add(((String) o).trim());
        int lineCount = lines.size();
        float textHeight = lineCount == 0 ? 0 : lineCount * 39 + (lineCount - 1) * 4,
              contentHeight = Math.max(128, textHeight), textTop = 1834 + (contentHeight - textHeight) / 2,
              iconTop = 1834 + (contentHeight - 128) / 2;
        // Tap once: 确认更新 (5 s); tap again: 更新中 until the server settles the "assistant" request.
        if (mark(data, "assistant") != null) {
            rect(74, iconTop, 202, iconTop + 128, INK);
            center("更新中", 138, base(iconTop, 128, Ink.SERIF_BOLD, T_H3, "更"), Ink.SERIF_BOLD, T_H3, PAPER);
        } else if (armed) {
            rect(74, iconTop, 202, iconTop + 128, FILL);
            hrule(74, iconTop, 202, RULE_BLOCK, INK);
            center("确认", 138, base(iconTop + 29, 34, Ink.SERIF_BOLD, T_H3, "确"), Ink.SERIF_BOLD, T_H3, INK);
            center("更新", 138, base(iconTop + 69, 34, Ink.SERIF_BOLD, T_H3, "更"), Ink.SERIF_BOLD, T_H3, INK);
        } else if (icon != null && icon.length == 128 * 128)
            ink.gray(icon, 128, 74, iconTop);
        else
            center("“", 138, iconTop + 151.5f, Ink.SERIF_LATIN_BOLD, QUOTE_GLYPH, INK);
        target(72, iconTop, 204, iconTop + 128, "hint");
        vrule(204, 1834, 1834 + contentHeight, RULE_ROW, INK);
        for (int i = 0; i < lineCount; i++)
            text(fit(lines.get(i), 1352, Ink.SANS_MEDIUM, T_TITLE), 226,
                base(textTop + 43 * i, 39, Ink.SANS_MEDIUM, T_TITLE, "日"), Ink.SANS_MEDIUM, T_TITLE, INK);
    }

    private void devices(Object data) {
        List<Object> devices = Json.list(data, "devices");
        int count = Math.min(8, devices.size()), columns = Math.min(4, count), rows = count > 4 ? 2 : 1;
        if (count == 0)
            return;
        float cardWidth = (1506 - (columns - 1) * 16) / columns, cardHeight = (110 - (rows - 1) * 12) / rows;
        for (int i = 0; i < count; i++) {
            float left = 72 + (i % columns) * (cardWidth + 16), top = 2034 + (i / columns) * (cardHeight + 12),
                  padding = rows == 1 ? 24 : 12, nameSize = rows == 1 ? T_TITLE : T_CAPTION,
                  stateSize = rows == 1 ? T_BODY : T_MICRO;
            rect(left, top, left + cardWidth, top + cardHeight, FILL);
            Object device = devices.get(i);
            boolean isOn = Json.bool(device, "on"), available = Json.bool(device, "available");
            String deviceId = Json.str(device, "id");
            String pendingMark = deviceId == null ? null : mark(data, "device:" + deviceId);
            // Waiting: the requested state with a grey bar and 正在开启…; unconfirmed: HA's own state, marked.
            if (isOn)
                hrule(left, top, left + cardWidth, RULE_BLOCK, "wait".equals(pendingMark) ? INK_3 : INK);
            // Configured names use Medium's complete CJK font; the heavier faces are subsets.
            text(fit(Json.str(device, "name"), cardWidth - padding * 2, Ink.SANS_MEDIUM, nameSize), left + padding,
                top + (rows == 1 ? 50.5f : 21), Ink.SANS_MEDIUM, nameSize, available ? INK : INK_3);
            Double durationMinutes = Json.num(device, "minutes");
            String stateText;
            if (!available) {
                stateText = "不可用";
            } else if (!isOn) {
                stateText = "关";
            } else if (durationMinutes != null) {
                stateText = Math.round(durationMinutes) + " 分钟后关闭";
            } else {
                stateText = "开";
            }
            if ("wait".equals(pendingMark))
                stateText = isOn ? "正在开启…" : "正在关闭…";
            else if ("unconfirmed".equals(pendingMark))
                stateText += " · 未确认";
            int stateColor = INK;
            if (!available) {
                stateColor = INK_3;
            } else if (pendingMark != null) {
                stateColor = INK_2;
            }
            text(fit(stateText, cardWidth - padding * 2, Ink.INTER_MEDIUM, stateSize), left + padding,
                top + (rows == 1 ? 85.5f : 44), Ink.INTER_MEDIUM, stateSize, stateColor);
            if (available && deviceId != null)
                target(left, top, left + cardWidth, top + cardHeight, "device:" + deviceId + (isOn ? ":off" : ":on"));
        }
    }

    private void menu(State viewState) {
        // Right-aligned under the status bar: 16 padding, four 168 x 72 buttons, divider before 取消, 3px outline.
        float l = 1578 - 754, t = 128;
        rect(l - RULE_TITLE, t - RULE_TITLE, 1578 + RULE_TITLE, t + 104 + RULE_TITLE, INK);
        rect(l, t, 1578, t + 104, PAPER);
        String[] labels = {"刷新", "设置", viewState.exitArm ? "确认退出" : "退出", "取消"};
        String[] actions = {"menu:refresh", "menu:settings", "menu:exit", "menu:cancel"};
        float x = l + 16;
        for (int i = 0; i < 4; i++) {
            if (i == 3) {
                vrule(x, t + 28, t + 76, RULE_ROW, INK);
                x += 14;
            }
            boolean armed = i == 2 && viewState.exitArm;
            rect(x, t + 16, x + 168, t + 88, armed ? INK : FILL);
            center(labels[i], x + 84, base(t + 16, 72, Ink.SANS_MEDIUM, T_TITLE, labels[i]), Ink.SANS_MEDIUM, T_TITLE,
                armed ? PAPER : INK);
            target(x, t + 16, x + 168, t + 88, actions[i]);
            x += 168 + 12;
        }
    }
}
