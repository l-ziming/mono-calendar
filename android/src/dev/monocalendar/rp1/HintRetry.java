package dev.monocalendar.rp1;

/** Read an empty hint again after 1, 2 and 4 minutes, sleeping between reads. */
public final class HintRetry {
    public int attempts;
    public long due;

    public HintRetry(int attempts, long due) {
        this.attempts = attempts;
        this.due = due;
    }

    public static boolean hasLines(Object data) {
        for (Object line : Json.list(Json.obj(data, "assistant"), "lines"))
            if (line instanceof String && !((String) line).trim().isEmpty())
                return true;
        return false;
    }

    public void observe(boolean hasLines, boolean online, long now) {
        if (hasLines) {
            attempts = 0;
            due = 0;
            return;
        }
        if (online && attempts == 0 && due == 0)
            due = next(now);
    }

    public boolean consume(long scheduled, long now) {
        if (due <= 0 || due != scheduled || now < due)
            return false;
        attempts++;
        due = next(now);
        return true;
    }

    private long next(long now) {
        if (attempts >= 3)
            return 0;
        return now + (60000L << attempts);
    }
}
