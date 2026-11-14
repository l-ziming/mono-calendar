import dev.monocalendar.rp1.*;
import java.awt.*;
import java.awt.font.FontRenderContext;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.List;
import javax.imageio.ImageIO;

/**
 * Desktop check: draws the RP1 page with Java2D from fixture data and writes a 16-grey PNG.
 * Usage: java PageRender data.json out.png [epochMillis|-] [battery] [wifi 0|1] [warning]; "-" uses the data time.
 * State overrides: -DacMode=heat_cool and -Dselected=2026-11-07 (a day whose 忌 list is just 无).
 * -Dlayout=6,8 checks configured room/device counts, long names and all device hit areas.
 * Fonts are read from the same files bundled into the APK (android/assets/fonts).
 */
public final class PageRender implements Ink {
    private final Graphics2D graphics;
    private final Font[] fonts = new Font[FONT_FILES.length];
    private final FontRenderContext fontContext;
    private final StringBuilder warningText = new StringBuilder();
    private final Set<String> drawnText = new HashSet<>();
    private Shape saved;

    PageRender(Graphics2D graphics, Path fontDir) throws Exception {
        this.graphics = graphics;
        for (int i = 0; i < FONT_FILES.length; i++)
            fonts[i] = Font.createFont(Font.TRUETYPE_FONT, fontDir.resolve(FONT_FILES[i]).toFile());
        if (!fonts[Ink.SANS_MEDIUM].canDisplay('龘'))
            throw new IllegalStateException("Default Medium must include uncommon characters in arbitrary titles");
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        fontContext = graphics.getFontRenderContext();
    }
    /** Only the page's grey roles may be drawn (Page.GREYS); a new grey means a new role, not a new value. */
    private Color grayColor(int gray) {
        boolean token = false;
        for (int g : Page.GREYS)
            token |= g == gray;
        if (!token)
            throw new IllegalStateException("Grey outside the design tokens: #" + Integer.toHexString(gray));
        return new Color(gray, gray, gray);
    }
    public void rect(float l, float t, float r, float b, int gray) {
        graphics.setColor(grayColor(gray));
        graphics.fill(new Rectangle2D.Float(l, t, r - l, b - t));
    }
    public void line(float x1, float y1, float x2, float y2, float w, int gray, float dash, float gap) {
        graphics.setColor(grayColor(gray));
        graphics.setStroke(dash > 0
                ? new BasicStroke(w, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER, 10, new float[] {dash, gap}, 0)
                : new BasicStroke(w, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        graphics.draw(new Line2D.Float(x1, y1, x2, y2));
    }
    private Font font(int fontIndex, float size) {
        return fonts[fontIndex].deriveFont(size);
    }
    public float measure(String text, int fontIndex, float size) {
        return (float) font(fontIndex, size).getStringBounds(text, fontContext).getWidth();
    }
    public void text(String text, float x, float y, int fontIndex, float size, int gray) {
        drawnText.add(text);
        if (y == 107 && size == 18 && gray == 255)
            warningText.append(text);
        if (fontIndex == Ink.SANS || fontIndex == Ink.INTER)
            throw new IllegalStateException("Design's default weight is 500: " + text);
        boolean scaled = false;
        for (float step : Page.TYPE_SCALE)
            scaled |= step == size;
        if (!scaled)
            throw new IllegalStateException("Text size outside the type scale (Page.TYPE_SCALE): " + size + " " + text);
        if ("“".equals(text) && fontIndex != Ink.SERIF_LATIN_BOLD)
            throw new IllegalStateException("Decorative quote uses Latin Noto Serif Bold");
        graphics.setColor(grayColor(gray));
        graphics.setFont(font(fontIndex, size));
        graphics.drawString(text, x, y);
    }
    public void path(float[] operations, int fill, float strokeWidth, int stroke, boolean round) {
        Path2D.Float path = new Path2D.Float();
        for (int i = 0; i < operations.length;) {
            int opcode = (int) operations[i++];
            if (opcode == 0) {
                path.moveTo(operations[i], operations[i + 1]);
                i += 2;
            } else if (opcode == 1) {
                path.lineTo(operations[i], operations[i + 1]);
                i += 2;
            } else if (opcode == 2) {
                path.curveTo(operations[i], operations[i + 1], operations[i + 2], operations[i + 3], operations[i + 4],
                    operations[i + 5]);
                i += 6;
            } else
                path.closePath();
        }
        if (fill >= 0) {
            graphics.setColor(grayColor(fill));
            graphics.fill(path);
        }
        if (stroke >= 0 && strokeWidth > 0) {
            graphics.setColor(grayColor(stroke));
            graphics.setStroke(new BasicStroke(strokeWidth, round ? BasicStroke.CAP_ROUND : BasicStroke.CAP_BUTT,
                round ? BasicStroke.JOIN_ROUND : BasicStroke.JOIN_MITER));
            graphics.draw(path);
        }
    }
    public void circle(float cx, float cy, float r, int fill, float strokeWidth, int stroke) {
        Ellipse2D.Float e = new Ellipse2D.Float(cx - r, cy - r, 2 * r, 2 * r);
        if (fill >= 0) {
            graphics.setColor(grayColor(fill));
            graphics.fill(e);
        }
        if (stroke >= 0 && strokeWidth > 0) {
            graphics.setColor(grayColor(stroke));
            graphics.setStroke(new BasicStroke(strokeWidth));
            graphics.draw(e);
        }
    }
    public void clip(float l, float t, float r, float b) {
        saved = graphics.getClip();
        graphics.clip(new Rectangle2D.Float(l, t, r - l, b - t));
    }
    public void unclip() {
        graphics.setClip(saved);
    }
    private final java.util.ArrayDeque<AffineTransform> turns = new java.util.ArrayDeque<>();
    public void turn(float degrees, float px, float py) {
        turns.push(graphics.getTransform());
        graphics.rotate(Math.toRadians(degrees), px, py);
    }
    public void unturn() {
        graphics.setTransform(turns.pop());
    }
    public void gray(byte[] pixels, int size, float left, float top) {
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_BYTE_GRAY);
        img.getRaster().setDataElements(0, 0, size, size, pixels);
        graphics.drawImage(img, Math.round(left), Math.round(top), null);
    }

    private static Page.Target checkTargetEdges(List<Page.Target> targets, String action) {
        Page.Target wanted = null;
        for (Page.Target target : targets)
            if (action.equals(target.action))
                wanted = target;
        if (wanted == null)
            throw new IllegalStateException("Missing target " + action);
        float cx = (wanted.left + wanted.right) / 2, cy = (wanted.top + wanted.bottom) / 2;
        float[][] edges = {{wanted.left + 0.5f, cy}, {wanted.right - 0.5f, cy},
            {cx, wanted.top + 0.5f}, {cx, wanted.bottom - 0.5f}};
        for (float[] point : edges) {
            Page.Target hit = null;
            for (int i = targets.size() - 1; i >= 0; i--)
                if (targets.get(i).contains(point[0], point[1])) {
                    hit = targets.get(i);
                    break;
                }
            if (hit != wanted)
                throw new IllegalStateException("Target edge misses " + action);
        }
        return wanted;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        Path root = Paths.get(System.getProperty("project", "."));
        Object data = Json.parse(new String(Files.readAllBytes(Paths.get(args[0])), "UTF-8"));
        String acMode = System.getProperty("acMode");
        if (acMode != null)
            Json.obj(data, "ac").put("mode", acMode);
        String layout = System.getProperty("layout");
        int roomCount = 0, deviceCount = 0;
        if (layout != null) {
            String[] counts = layout.split(",");
            roomCount = Integer.parseInt(counts[0]);
            deviceCount = Integer.parseInt(counts[1]);
            List<Object> rooms = new ArrayList<>(), devices = new ArrayList<>();
            for (int i = 0; i < roomCount; i++) {
                Map<String, Object> room = new LinkedHashMap<>();
                room.put("id", "room_" + i);
                room.put("name", "房间" + i + " 龘字和很长的自定义房间名称不能越过这一格");
                room.put("temp", i == 0 ? null : 18.5 + i);
                room.put("humidity", i == 1 ? null : 40.0 + i);
                rooms.add(room);
            }
            for (int i = 0; i < deviceCount; i++) {
                Map<String, Object> device = new LinkedHashMap<>();
                device.put("id", "device_" + i);
                device.put("name", "设备" + i + " 龘字和很长的自定义设备名称不能越过这一格");
                device.put("on", i % 2 == 0);
                device.put("available", true);
                if (i == deviceCount - 1)
                    device.put("minutes", 15.0);
                devices.add(device);
            }
            ((Map<String, Object>) data).put("rooms", rooms);
            ((Map<String, Object>) data).put("devices", devices);
        }
        long now = args.length > 2 && !"-".equals(args[2]) ? Long.parseLong(args[2])
                                                           : ((Double) ((Map<?, ?>) data).get("dataTime")).longValue();
        Almanac almanac = new Almanac(new FileInputStream(root.resolve("android/assets/almanac.bin").toFile()),
            new FileInputStream(root.resolve("android/assets/almanac-lists.txt").toFile()));
        BufferedImage image = new BufferedImage(Page.W, Page.H, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = image.createGraphics();
        PageRender ink = new PageRender(graphics, root.resolve("android/assets/fonts"));
        Page.Status status = new Page.Status();
        status.battery = args.length > 3 ? Integer.parseInt(args[3]) : 15;
        status.charging = Boolean.getBoolean("charging");
        status.full = status.charging && status.battery >= 100;
        status.wifi = args.length <= 4 || !"0".equals(args[4]);
        status.warning = args.length > 5 ? args[5] : "截至 15:00 已 30 分钟未更新，请充电";
        Page.State state = new Page.State();
        String selectedDate = System.getProperty("selected");
        if (selectedDate != null) {
            String[] date = selectedDate.split("-");
            state.viewYear = Integer.parseInt(date[0]);
            state.viewMonth = Integer.parseInt(date[1]);
            state.selected = Almanac.epochDay(state.viewYear, state.viewMonth, Integer.parseInt(date[2]));
        }
        if (System.getProperty("menu") != null) {
            state.menu = true;
            state.exitArm = "armed".equals(System.getProperty("menu"));
        }
        // -Dcard=宜:嫁娶 opens an explanation card; -Dicon=picture.png stands in for HA's hint image.
        state.hintArm = Boolean.getBoolean("hintArm");
        String card = System.getProperty("card");
        if (card != null) {
            String[] cardParts = card.split(":", 2);
            state.cardKind = cardParts[0];
            state.card = cardParts[1];
        }
        String iconPath = System.getProperty("icon");
        if (iconPath != null) {
            BufferedImage sourceImage = ImageIO.read(new File(iconPath));
            int side = Math.min(sourceImage.getWidth(), sourceImage.getHeight());
            BufferedImage smallIcon = new BufferedImage(128, 128, BufferedImage.TYPE_BYTE_GRAY);
            Graphics2D iconGraphics = smallIcon.createGraphics();
            iconGraphics.setColor(Color.WHITE);
            iconGraphics.fillRect(0, 0, 128, 128);
            iconGraphics.setRenderingHint(
                RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            iconGraphics.drawImage(sourceImage, 0, 0, 128, 128, (sourceImage.getWidth() - side) / 2,
                (sourceImage.getHeight() - side) / 2, (sourceImage.getWidth() + side) / 2,
                (sourceImage.getHeight() + side) / 2, null);
            iconGraphics.dispose();
            status.icon = new byte[128 * 128];
            smallIcon.getRaster().getDataElements(0, 0, 128, 128, status.icon);
        }
        String timezoneId = Json.str(data, "timezone");
        long started = System.nanoTime();
        List<Page.Target> targets = new Page(almanac).draw(
            ink, data, state, status, now, TimeZone.getTimeZone(timezoneId == null ? "America/Denver" : timezoneId));
        if (!status.warning.equals(ink.warningText.toString()))
            throw new IllegalStateException("Warning text was truncated: " + ink.warningText);
        System.err.printf("drew in %.0f ms, %d targets%n", (System.nanoTime() - started) / 1e6, targets.size());
        for (Page.Target target : targets) {
            if (target.right - target.left < 44 - 0.01 || target.bottom - target.top < 44 - 0.01)
                throw new IllegalStateException("Small target " + target.action);
            if (target.left < 0 || target.top < 0 || target.right > Page.W + 8 || target.bottom > Page.H)
                throw new IllegalStateException("Target outside page " + target.action);
        }
        if ("heat_cool".equals(acMode)) {
            List<Page.Target> range = new ArrayList<>();
            for (String action : new String[] {"range_low_down", "range_low_up", "range_high_down", "range_high_up"})
                range.add(checkTargetEdges(targets, action));
            for (int i = 0; i < range.size(); i++)
                for (int j = i + 1; j < range.size(); j++) {
                    Page.Target a = range.get(i), b = range.get(j);
                    if (Math.max(a.left, b.left) < Math.min(a.right, b.right)
                        && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom))
                        throw new IllegalStateException("Range targets overlap: " + a.action + " and " + b.action);
                }
        }
        if ("2026-11-07".equals(selectedDate))
            checkTargetEdges(targets, "card:忌:无");
        if (layout != null) {
            if (roomCount == 0 && (ink.drawnText.contains("客厅") || ink.drawnText.contains("卧室")))
                throw new IllegalStateException("Empty room list must not fall back to legacy rooms");
            for (int i = 0; i < roomCount; i++) {
                final String prefix = "房间" + i;
                if (ink.drawnText.stream().noneMatch(text -> text.startsWith(prefix)))
                    throw new IllegalStateException("Configured room not drawn " + i);
            }
            List<Page.Target> deviceTargets = new ArrayList<>();
            for (int i = 0; i < deviceCount; i++) {
                final String prefix = "设备" + i;
                if (ink.drawnText.stream().noneMatch(text -> text.startsWith(prefix)))
                    throw new IllegalStateException("Configured device not drawn " + i);
                Page.Target target = checkTargetEdges(targets, "device:device_" + i + (i % 2 == 0 ? ":off" : ":on"));
                if (target.left < 72 || target.top < 2034 || target.right > 1578 || target.bottom > 2144)
                    throw new IllegalStateException("Configured device outside its region " + i);
                deviceTargets.add(target);
            }
            for (Page.Target a : deviceTargets)
                for (Page.Target b : deviceTargets)
                    if (a != b && Math.max(a.left, b.left) < Math.min(a.right, b.right)
                        && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom))
                        throw new IllegalStateException("Configured device targets overlap");
            if (deviceCount == 0 && targets.stream().anyMatch(target -> target.action.startsWith("device:")))
                throw new IllegalStateException("Empty device list must have no control targets");
        }
        graphics.dispose();
        BufferedImage grey = new BufferedImage(Page.W, Page.H, BufferedImage.TYPE_BYTE_GRAY);
        for (int y = 0; y < Page.H; y++)
            for (int x = 0; x < Page.W; x++) {
                int gray = Ink.rgbToGray(image.getRGB(x, y));
                int quantizedGray = Math.round(gray / 17f) * 17;
                grey.getRaster().setSample(x, y, 0, quantizedGray);
            }
        ImageIO.write(grey, "png", new File(args[1]));
        if (System.getProperty("targets") != null)
            for (Page.Target target : targets)
                System.out.printf(
                    "%s %.0f %.0f %.0f %.0f%n", target.action, target.left, target.top, target.right, target.bottom);
    }
}
