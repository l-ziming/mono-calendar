package dev.monocalendar.rp1;

/**
 * Read ordering for /data. Writes no longer touch the cached document (they live in Requests), so
 * the only rules left: one quarter sync in flight at a time, a late callback cannot retire a newer
 * one, and an older document (by the server's own data time) never replaces a newer one.
 */
public final class RemoteState {
    private long sequence = System.nanoTime() & Long.MAX_VALUE;
    private long activeReadId;
    public long beginRead() {
        if (activeReadId != 0)
            return 0;
        activeReadId = ++sequence;
        return activeReadId;
    }
    public boolean finishRead(long id) {
        if (id == 0 || id != activeReadId)
            return false;
        activeReadId = 0;
        return true;
    }
    /** Server data times, not the RP1's clock: a slow reply that was read earlier is discarded. */
    public static boolean canAcceptDataTime(Object currentData, long freshDataTime) {
        if (freshDataTime <= 0) {
            return true;
        }
        Double currentDataTime = Json.num(currentData, "dataTime");
        if (currentDataTime == null) {
            return true;
        }
        return freshDataTime >= currentDataTime.longValue();
    }
}
