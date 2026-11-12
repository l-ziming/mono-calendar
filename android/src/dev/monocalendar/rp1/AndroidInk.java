package dev.monocalendar.rp1;

import android.content.res.AssetManager;
import android.graphics.*;

/** Ink on an Android Canvas, with the design's fonts bundled in assets/fonts. */
public final class AndroidInk implements Ink {
    private final Typeface[] typefaces = new Typeface[FONT_FILES.length];
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG),
                        shapePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private Canvas canvas;

    public AndroidInk(AssetManager assets) {
        for (int i = 0; i < FONT_FILES.length; i++) {
            try {
                typefaces[i] = Typeface.createFromAsset(assets, "fonts/" + FONT_FILES[i]);
            } catch (RuntimeException missing) {
                typefaces[i] = i >= INTER && i != SANS_SEMIBOLD ? Typeface.SANS_SERIF : Typeface.DEFAULT;
            }
        }
        textPaint.setDither(false);
        shapePaint.setDither(false);
    }
    public void setCanvas(Canvas c) {
        canvas = c;
    }
    private static int gray(int grayValue) {
        return Color.rgb(grayValue, grayValue, grayValue);
    }

    @Override
    public void rect(float left, float top, float right, float bottom, int grayValue) {
        shapePaint.setStyle(Paint.Style.FILL);
        shapePaint.setColor(gray(grayValue));
        canvas.drawRect(left, top, right, bottom, shapePaint);
    }
    @Override
    public void line(float x1, float y1, float x2, float y2, float w, int grayValue, float dash, float gap) {
        shapePaint.setStyle(Paint.Style.STROKE);
        shapePaint.setColor(gray(grayValue));
        shapePaint.setStrokeWidth(w);
        shapePaint.setStrokeCap(dash > 0 ? Paint.Cap.BUTT : Paint.Cap.ROUND);
        shapePaint.setPathEffect(dash > 0 ? new DashPathEffect(new float[] {dash, gap}, 0) : null);
        canvas.drawLine(x1, y1, x2, y2, shapePaint);
        shapePaint.setPathEffect(null);
    }
    @Override
    public float measure(String content, int font, float size) {
        textPaint.setTypeface(typefaces[font]);
        textPaint.setTextSize(size);
        return textPaint.measureText(content);
    }
    @Override
    public void text(String content, float x, float y, int font, float size, int grayValue) {
        textPaint.setTypeface(typefaces[font]);
        textPaint.setTextSize(size);
        textPaint.setColor(gray(grayValue));
        canvas.drawText(content, x, y, textPaint);
    }
    @Override
    public void path(float[] ops, int fill, float strokeWidth, int stroke, boolean round) {
        path.reset();
        for (int i = 0; i < ops.length;) {
            int op = (int) ops[i++];
            if (op == 0) {
                path.moveTo(ops[i], ops[i + 1]);
                i += 2;
            } else if (op == 1) {
                path.lineTo(ops[i], ops[i + 1]);
                i += 2;
            } else if (op == 2) {
                path.cubicTo(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5]);
                i += 6;
            } else
                path.close();
        }
        if (fill >= 0) {
            shapePaint.setStyle(Paint.Style.FILL);
            shapePaint.setColor(gray(fill));
            canvas.drawPath(path, shapePaint);
        }
        if (stroke >= 0 && strokeWidth > 0) {
            shapePaint.setStyle(Paint.Style.STROKE);
            shapePaint.setColor(gray(stroke));
            shapePaint.setStrokeWidth(strokeWidth);
            shapePaint.setStrokeCap(round ? Paint.Cap.ROUND : Paint.Cap.BUTT);
            shapePaint.setStrokeJoin(round ? Paint.Join.ROUND : Paint.Join.MITER);
            canvas.drawPath(path, shapePaint);
        }
    }
    @Override
    public void circle(float cx, float cy, float radius, int fill, float strokeWidth, int stroke) {
        if (fill >= 0) {
            shapePaint.setStyle(Paint.Style.FILL);
            shapePaint.setColor(gray(fill));
            canvas.drawCircle(cx, cy, radius, shapePaint);
        }
        if (stroke >= 0 && strokeWidth > 0) {
            shapePaint.setStyle(Paint.Style.STROKE);
            shapePaint.setColor(gray(stroke));
            shapePaint.setStrokeWidth(strokeWidth);
            canvas.drawCircle(cx, cy, radius, shapePaint);
        }
    }
    @Override
    public void clip(float left, float top, float right, float bottom) {
        canvas.save();
        canvas.clipRect(left, top, right, bottom);
    }
    @Override
    public void unclip() {
        canvas.restore();
    }
    @Override
    public void turn(float degrees, float px, float py) {
        canvas.save();
        canvas.rotate(degrees, px, py);
    }
    @Override
    public void unturn() {
        canvas.restore();
    }
    @Override
    public void gray(byte[] pixels, int size, float left, float top) {
        int[] argb = new int[size * size];
        for (int i = 0; i < argb.length; i++) {
            int v = pixels[i] & 255;
            argb[i] = 0xff000000 | v << 16 | v << 8 | v;
        }
        canvas.drawBitmap(Bitmap.createBitmap(argb, size, size, Bitmap.Config.ARGB_8888), left, top, null);
    }
}
