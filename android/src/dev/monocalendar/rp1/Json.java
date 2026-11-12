package dev.monocalendar.rp1;

import java.util.*;

/** Minimal JSON reader (objects, arrays, strings, numbers, booleans, null), free of Android APIs. */
public final class Json {
    private final String source;
    private int position;
    private Json(String source) {
        this.source = source;
    }
    public static Object parse(String text) {
        Json reader = new Json(text);
        Object value = reader.value();
        reader.space();
        if (reader.position != text.length())
            throw new IllegalArgumentException("Trailing JSON at " + reader.position);
        return value;
    }

    public static Object copy(Object value) {
        return parse(write(value));
    }
    private void space() {
        while (position < source.length() && source.charAt(position) <= ' ')
            position++;
    }
    private Object value() {
        space();
        if (position >= source.length())
            throw new IllegalArgumentException("Unexpected end of JSON");
        char character = source.charAt(position);
        if (character == '{') {
            position++;
            Map<String, Object> members = new LinkedHashMap<>();
            space();
            if (source.charAt(position) == '}') {
                position++;
                return members;
            }
            while (true) {
                space();
                String key = string();
                space();
                expect(':');
                members.put(key, value());
                space();
                if (source.charAt(position) == ',') {
                    position++;
                    continue;
                }
                expect('}');
                return members;
            }
        }
        if (character == '[') {
            position++;
            List<Object> items = new ArrayList<>();
            space();
            if (source.charAt(position) == ']') {
                position++;
                return items;
            }
            while (true) {
                items.add(value());
                space();
                if (source.charAt(position) == ',') {
                    position++;
                    continue;
                }
                expect(']');
                return items;
            }
        }
        if (character == '"')
            return string();
        if (source.startsWith("true", position)) {
            position += 4;
            return Boolean.TRUE;
        }
        if (source.startsWith("false", position)) {
            position += 5;
            return Boolean.FALSE;
        }
        if (source.startsWith("null", position)) {
            position += 4;
            return null;
        }
        int start = position;
        while (position < source.length() && "+-0123456789.eE".indexOf(source.charAt(position)) >= 0)
            position++;
        if (start == position)
            throw new IllegalArgumentException("Bad JSON at " + position);
        return Double.parseDouble(source.substring(start, position));
    }
    private void expect(char character) {
        if (position >= source.length() || source.charAt(position) != character)
            throw new IllegalArgumentException("Expected " + character + " at " + position);
        position++;
    }
    private String string() {
        expect('"');
        StringBuilder builder = new StringBuilder();
        while (true) {
            char character = source.charAt(position++);
            if (character == '"')
                return builder.toString();
            if (character != '\\') {
                builder.append(character);
                continue;
            }
            char escapeCharacter = source.charAt(position++);
            switch (escapeCharacter) {
                case 'n':
                    builder.append('\n');
                    break;
                case 't':
                    builder.append('\t');
                    break;
                case 'r':
                    builder.append('\r');
                    break;
                case 'b':
                    builder.append('\b');
                    break;
                case 'f':
                    builder.append('\f');
                    break;
                case 'u':
                    builder.append((char) Integer.parseInt(source.substring(position, position + 4), 16));
                    position += 4;
                    break;
                default:
                    builder.append(escapeCharacter);
            }
        }
    }

    // Typed accessors that tolerate missing or mistyped fields.
    @SuppressWarnings("unchecked")
    private static Object field(Object object, String key) {
        if (!(object instanceof Map)) {
            return null;
        }
        return ((Map<String, Object>) object).get(key);
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object object, String key) {
        Object value = field(object, key);
        return value instanceof Map ? (Map<String, Object>) value : Collections.<String, Object>emptyMap();
    }
    @SuppressWarnings("unchecked")
    public static List<Object> list(Object object, String key) {
        Object value = field(object, key);
        return value instanceof List ? (List<Object>) value : Collections.emptyList();
    }
    @SuppressWarnings("unchecked")
    public static String str(Object object, String key) {
        Object value = field(object, key);
        return value instanceof String ? (String) value : null;
    }
    @SuppressWarnings("unchecked")
    public static Double num(Object object, String key) {
        Object value = field(object, key);
        return value instanceof Double && !((Double) value).isNaN() ? (Double) value : null;
    }
    @SuppressWarnings("unchecked")
    public static boolean bool(Object object, String key) {
        Object value = field(object, key);
        return Boolean.TRUE.equals(value);
    }

    /** Compact serialisation (the inverse of parse), used to copy documents. */
    @SuppressWarnings("unchecked")
    public static String write(Object object) {
        if (object == null)
            return "null";
        if (object instanceof String)
            return quote((String) object);
        if (object instanceof Double) {
            double number = (Double) object;
            return number == Math.rint(number) && Math.abs(number) < 1e15 ? String.valueOf((long) number)
                                                                          : String.valueOf(number);
        }
        if (object instanceof Boolean)
            return object.toString();
        StringBuilder builder = new StringBuilder();
        boolean first = true;
        if (object instanceof Map) {
            builder.append('{');
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) object).entrySet()) {
                if (!first)
                    builder.append(',');
                first = false;
                builder.append(quote(entry.getKey())).append(':').append(write(entry.getValue()));
            }
            return builder.append('}').toString();
        }
        builder.append('[');
        for (Object value : (List<Object>) object) {
            if (!first)
                builder.append(',');
            first = false;
            builder.append(write(value));
        }
        return builder.append(']').toString();
    }
    public static String quote(String value) {
        StringBuilder builder = new StringBuilder("\"");
        for (char character : value.toCharArray()) {
            if (character == '"' || character == '\\')
                builder.append('\\').append(character);
            else if (character < 0x20)
                builder.append(String.format("\\u%04x", (int) character));
            else
                builder.append(character);
        }
        return builder.append('"').toString();
    }
}
