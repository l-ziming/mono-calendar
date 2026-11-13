import dev.monocalendar.rp1.Ink;
import dev.monocalendar.rp1.Svg;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;

/** Renders design/icon/logo.svg (rect and path elements only) to square PNGs: IconRender logo.svg size:out.png ... */
public final class IconRender {
    private static final Pattern ELEMENT = Pattern.compile("<(rect|path)\\b([^>]*)/>");
    private static final Pattern ATTRIBUTE = Pattern.compile("([a-z-]+)=\"([^\"]*)\"");

    public static void main(String[] args) throws Exception {
        String svg = new String(Files.readAllBytes(new File(args[0]).toPath()), StandardCharsets.UTF_8);
        Matcher box = Pattern.compile("viewBox=\"([^\"]+)\"").matcher(svg);
        if (!box.find())
            throw new IllegalArgumentException("logo.svg needs a viewBox");
        String[] viewBox = box.group(1).trim().split("[\\s,]+");
        float crop = Float.parseFloat(System.getProperty("crop", "0"));
        float minX = Float.parseFloat(viewBox[0]) + crop;
        float minY = Float.parseFloat(viewBox[1]) + crop;
        float width = Float.parseFloat(viewBox[2]) - crop * 2;
        for (int i = 1; i < args.length; i++) {
            String[] target = args[i].split(":", 2);
            int size = Integer.parseInt(target[0]);
            BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = image.createGraphics();
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
            graphics.clip(new Rectangle2D.Float(0, 0, size, size));
            float scale = size / width;
            Matcher element = ELEMENT.matcher(svg);
            while (element.find())
                draw(graphics, element.group(1), element.group(2), minX, minY, scale);
            graphics.dispose();
            ImageIO.write(image, "png", new File(target[1]));
        }
    }

    private static void draw(Graphics2D graphics, String kind, String attributes, float minX, float minY, float scale) {
        java.util.Map<String, String> parsedAttributes = new java.util.HashMap<>();
        Matcher attribute = ATTRIBUTE.matcher(attributes);
        while (attribute.find())
            parsedAttributes.put(attribute.group(1), attribute.group(2));
        java.awt.Shape shape;
        if (kind.equals("rect")) {
            shape = new Rectangle2D.Float((Float.parseFloat(parsedAttributes.get("x")) - minX) * scale,
                (Float.parseFloat(parsedAttributes.get("y")) - minY) * scale,
                Float.parseFloat(parsedAttributes.get("width")) * scale,
                Float.parseFloat(parsedAttributes.get("height")) * scale);
        } else {
            float[] operations = Svg.path(parsedAttributes.get("d"), -minX * scale, -minY * scale, scale);
            int windingRule = Path2D.WIND_NON_ZERO;
            if ("evenodd".equals(parsedAttributes.get("fill-rule")))
                windingRule = Path2D.WIND_EVEN_ODD;
            Path2D.Float path = new Path2D.Float(windingRule);
            for (int i = 0; i < operations.length;) {
                float operation = operations[i++];
                if (operation == Ink.MOVE)
                    path.moveTo(operations[i++], operations[i++]);
                else if (operation == Ink.LINE)
                    path.lineTo(operations[i++], operations[i++]);
                else if (operation == Ink.CUBIC)
                    path.curveTo(operations[i++], operations[i++], operations[i++], operations[i++], operations[i++],
                        operations[i++]);
                else
                    path.closePath();
            }
            shape = path;
        }
        String fill = parsedAttributes.getOrDefault("fill", "#000000");
        String stroke = parsedAttributes.get("stroke");
        if (!fill.equals("none")) {
            graphics.setColor(Color.decode(fill));
            graphics.fill(shape);
        }
        if (stroke != null && !stroke.equals("none")) {
            graphics.setColor(Color.decode(stroke));
            graphics.setStroke(
                new BasicStroke(Float.parseFloat(parsedAttributes.getOrDefault("stroke-width", "1")) * scale));
            graphics.draw(shape);
        }
    }
}
