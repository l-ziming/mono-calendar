package dev.monocalendar.rp1;

/** The few drawing primitives the page needs; Android Canvas on the RP1, Java2D in desktop checks. */
public interface Ink {
    int SANS = 0, SANS_MEDIUM = 1, SANS_BOLD = 2, SERIF = 3, SERIF_BOLD = 4, INTER = 5, INTER_MEDIUM = 6,
        INTER_SEMIBOLD = 7, SERIF_LATIN_BOLD = 8, SANS_SEMIBOLD = 9, INTER_BOLD = 10;
    String[] FONT_FILES = {"NotoSansSC-Regular.otf", "NotoSansSC-Medium.otf", "NotoSansSC-Bold.otf",
        "NotoSerifSC-Medium.otf", "NotoSerifSC-Bold.otf", "Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf",
        "NotoSerif-Bold.ttf", "NotoSansSC-SemiBold.ttf", "Inter-Bold.ttf"};

    static int rgbToGray(int rgb) {
        int red = rgb >> 16 & 255;
        int green = rgb >> 8 & 255;
        int blue = rgb & 255;
        return (red * 299 + green * 587 + blue * 114) / 1000;
    }
    /** Path opcodes in a float array: MOVE x y, LINE x y, CUBIC x1 y1 x2 y2 x y, CLOSE. */
    float MOVE = 0, LINE = 1, CUBIC = 2, CLOSE = 3;
    void rect(float left, float top, float right, float bottom, int gray);
    void line(float x1, float y1, float x2, float y2, float width, int gray, float dash, float gap);
    /** Advance width of a single-font run. */
    float measure(String text, int font, float size);
    /** A single-font run with its baseline at y. */
    void text(String text, float x, float baseline, int font, float size, int gray);
    /** fill or stroke &lt; 0 skips that part; round selects round caps and joins. */
    void path(float[] ops, int fill, float strokeWidth, int stroke, boolean round);
    void circle(float cx, float cy, float radius, int fill, float strokeWidth, int stroke);
    void clip(float left, float top, float right, float bottom);
    void unclip();
    /** Rotates what follows by degrees (clockwise on screen) about px, py until unturn(). */
    void turn(float degrees, float px, float py);
    void unturn();
    /** An 8-bit grey image (row-major, size x size) drawn into a size x size square at left, top. */
    void gray(byte[] pixels, int size, float left, float top);
}
