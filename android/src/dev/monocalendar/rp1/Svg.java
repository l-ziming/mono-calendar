package dev.monocalendar.rp1;

import java.util.Arrays;

/** Parses the design's SVG path data (M L H V C A Z, absolute and relative) into Ink opcodes. */
public final class Svg {
    private float[] operations = new float[64];
    private int operationCount;
    private float x, y, startX, startY;
    private Svg() {
    }

    /** Path data in a w x w icon box, drawn at (left, top) scaled to size. */
    public static float[] path(String data, float left, float top, float scale) {
        Svg parser = new Svg();
        parser.parse(data);
        float[] transformed = Arrays.copyOf(parser.operations, parser.operationCount);
        for (int i = 0; i < transformed.length;) {
            int opcode = (int) transformed[i++];
            int points = 0;
            if (opcode == 0 || opcode == 1) {
                points = 1;
            } else if (opcode == 2) {
                points = 3;
            }
            for (int p = 0; p < points; p++) {
                transformed[i] = left + transformed[i] * scale;
                transformed[i + 1] = top + transformed[i + 1] * scale;
                i += 2;
            }
        }
        return transformed;
    }

    private void add(float... values) {
        if (operationCount + values.length > operations.length)
            operations = Arrays.copyOf(operations, Math.max(operations.length * 2, operationCount + values.length));
        System.arraycopy(values, 0, operations, operationCount, values.length);
        operationCount += values.length;
    }

    private void parse(String pathData) {
        int i = 0;
        char command = 0;
        while (true) {
            while (i < pathData.length() && (pathData.charAt(i) == ' ' || pathData.charAt(i) == ','))
                i++;
            if (i >= pathData.length())
                return;
            char c = pathData.charAt(i);
            if (Character.isLetter(c)) {
                command = c;
                i++;
                if (c == 'Z' || c == 'z') {
                    add(Ink.CLOSE);
                    x = startX;
                    y = startY;
                    continue;
                }
            }
            boolean rel = Character.isLowerCase(command);
            float[] values;
            switch (Character.toUpperCase(command)) {
                case 'M':
                    values = numbers(pathData, i, 2);
                    i = parsedEnd;
                    x = rel ? x + values[0] : values[0];
                    y = rel ? y + values[1] : values[1];
                    startX = x;
                    startY = y;
                    add(Ink.MOVE, x, y);
                    command = rel ? 'l' : 'L';
                    break;
                case 'L':
                    values = numbers(pathData, i, 2);
                    i = parsedEnd;
                    x = rel ? x + values[0] : values[0];
                    y = rel ? y + values[1] : values[1];
                    add(Ink.LINE, x, y);
                    break;
                case 'H':
                    values = numbers(pathData, i, 1);
                    i = parsedEnd;
                    x = rel ? x + values[0] : values[0];
                    add(Ink.LINE, x, y);
                    break;
                case 'V':
                    values = numbers(pathData, i, 1);
                    i = parsedEnd;
                    y = rel ? y + values[0] : values[0];
                    add(Ink.LINE, x, y);
                    break;
                case 'C':
                    values = numbers(pathData, i, 6);
                    i = parsedEnd;
                    float ox = rel ? x : 0, oy = rel ? y : 0;
                    add(Ink.CUBIC, ox + values[0], oy + values[1], ox + values[2], oy + values[3], ox + values[4],
                        oy + values[5]);
                    x = ox + values[4];
                    y = oy + values[5];
                    break;
                case 'A':
                    values = numbers(pathData, i, 7);
                    i = parsedEnd;
                    float tx = rel ? x + values[5] : values[5], ty = rel ? y + values[6] : values[6];
                    arc(x, y, values[0], values[1], values[2], values[3] != 0, values[4] != 0, tx, ty);
                    x = tx;
                    y = ty;
                    break;
                default:
                    throw new IllegalArgumentException("Unsupported path command " + command);
            }
        }
    }
    private int parsedEnd;
    private float[] numbers(String pathData, int i, int count) {
        float[] values = new float[count];
        for (int k = 0; k < count; k++) {
            while (i < pathData.length() && (pathData.charAt(i) == ' ' || pathData.charAt(i) == ','))
                i++;
            int s = i;
            if (i < pathData.length() && (pathData.charAt(i) == '-' || pathData.charAt(i) == '+'))
                i++;
            boolean dot = false;
            while (i < pathData.length()) {
                char c = pathData.charAt(i);
                if (Character.isDigit(c))
                    i++;
                else if (c == '.' && !dot) {
                    dot = true;
                    i++;
                } else if ((c == 'e' || c == 'E') && i + 1 < pathData.length()) {
                    i++;
                    if (pathData.charAt(i) == '-' || pathData.charAt(i) == '+')
                        i++;
                } else
                    break;
            }
            if (s == i)
                throw new IllegalArgumentException("Bad path number at " + s);
            values[k] = Float.parseFloat(pathData.substring(s, i));
        }
        parsedEnd = i;
        return values;
    }
    /** SVG endpoint arc to cubic Béziers (W3C SVG implementation notes F.6). */
    private void arc(
        float x1, float y1, float rx, float ry, float rotation, boolean large, boolean sweep, float x2, float y2) {
        if (rx == 0 || ry == 0) {
            add(Ink.LINE, x2, y2);
            return;
        }
        double phi = Math.toRadians(rotation), cos = Math.cos(phi), sin = Math.sin(phi);
        double dx = (x1 - x2) / 2.0, dy = (y1 - y2) / 2.0, px = cos * dx + sin * dy, py = -sin * dx + cos * dy;
        double a = Math.abs(rx), b = Math.abs(ry), lambda = px * px / (a * a) + py * py / (b * b);
        if (lambda > 1) {
            a *= Math.sqrt(lambda);
            b *= Math.sqrt(lambda);
        }
        double num = a * a * b * b - a * a * py * py - b * b * px * px, den = a * a * py * py + b * b * px * px;
        double k = Math.sqrt(Math.max(0, num / den)) * (large == sweep ? -1 : 1);
        double cxp = k * a * py / b, cyp = -k * b * px / a;
        double cx = cos * cxp - sin * cyp + (x1 + x2) / 2.0, cy = sin * cxp + cos * cyp + (y1 + y2) / 2.0;
        double t1 = Math.atan2((py - cyp) / b, (px - cxp) / a), t2 = Math.atan2((-py - cyp) / b, (-px - cxp) / a),
               delta = t2 - t1;
        if (sweep && delta < 0)
            delta += 2 * Math.PI;
        else if (!sweep && delta > 0)
            delta -= 2 * Math.PI;
        int segments = (int) Math.ceil(Math.abs(delta) / (Math.PI / 2));
        double step = delta / segments, alpha = 4.0 / 3 * Math.tan(step / 4);
        for (int s = 0; s < segments; s++) {
            double t = t1 + s * step, u = t + step;
            double ex1 = Math.cos(t), ey1 = Math.sin(t), ex2 = Math.cos(u), ey2 = Math.sin(u);
            double q1x = a * (ex1 - alpha * ey1), q1y = b * (ey1 + alpha * ex1), q2x = a * (ex2 + alpha * ey2),
                   q2y = b * (ey2 - alpha * ex2), ex = a * ex2, ey = b * ey2;
            add(Ink.CUBIC, (float) (cx + cos * q1x - sin * q1y), (float) (cy + sin * q1x + cos * q1y),
                (float) (cx + cos * q2x - sin * q2y), (float) (cy + sin * q2x + cos * q2y),
                (float) (cx + cos * ex - sin * ey), (float) (cy + sin * ex + cos * ey));
        }
    }
}
