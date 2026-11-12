import dev.monocalendar.rp1.ConnectionSettings;
import dev.monocalendar.rp1.QuarterClock;
import java.time.Instant;
import java.util.TimeZone;
public class QuarterClockCheck {
    private static long at(String value) {
        return Instant.parse(value).toEpochMilli();
    }
    public static void main(String[] args) throws Exception {
        TimeZone zone = TimeZone.getTimeZone("America/Denver");
        assert QuarterClock.next(at("2026-11-06T21:29:59.999Z"), zone) == at("2026-11-06T21:30:00Z");
        assert QuarterClock.next(at("2026-11-06T21:30:00Z"), zone) == at("2026-11-06T21:45:00Z");
        assert QuarterClock.next(at("2026-03-08T08:59:59Z"), zone) == at("2026-03-08T09:00:00Z");
        assert QuarterClock.next(at("2026-11-01T07:59:59Z"), zone) == at("2026-11-01T08:00:00Z");
        // Night (00:00-06:00 local) wakes only on the hour, through both DST repeats and gaps.
        assert QuarterClock.next(at("2026-11-01T07:00:00Z"), zone)
            == at("2026-11-01T08:00:00Z"); // 01:00 MDT -> 01:00 MST
        assert QuarterClock.next(at("2026-11-01T08:00:00Z"), zone) == at("2026-11-01T09:00:00Z");
        assert QuarterClock.next(at("2026-11-07T06:59:00Z"), zone) == at("2026-11-07T07:00:00Z"); // 23:59 -> 00:00
        assert QuarterClock.next(at("2026-11-07T12:00:00Z"), zone) == at("2026-11-07T13:00:00Z"); // 05:00 -> 06:00
        assert QuarterClock.next(at("2026-11-07T13:00:00Z"), zone) == at("2026-11-07T13:15:00Z"); // day: every quarter
        for (String start : new String[] {"2026-03-08T05:00:00Z", "2026-11-01T05:00:00Z"}) {
            long from = at(start);
            for (long now = from; now < from + 10 * 3600000; now += 15000) {
                long next = QuarterClock.next(now, zone);
                java.util.Calendar calendar = java.util.Calendar.getInstance(zone);
                calendar.setTimeInMillis(next);
                int hour = calendar.get(java.util.Calendar.HOUR_OF_DAY),
                    minute = calendar.get(java.util.Calendar.MINUTE), second = calendar.get(java.util.Calendar.SECOND);
                boolean night = hour >= QuarterClock.NIGHT_FROM && hour < QuarterClock.NIGHT_TO;
                calendar.setTimeInMillis(now);
                int nowHour = calendar.get(java.util.Calendar.HOUR_OF_DAY);
                boolean wasNight = nowHour >= QuarterClock.NIGHT_FROM && nowHour < QuarterClock.NIGHT_TO;
                assert next > now && next - now <= (night || wasNight ? 3600000 : QuarterClock.INTERVAL);
                assert minute % 15 == 0 && second == 0 && (!night || minute == 0);
            }
        }
        assert QuarterClock.sameSlot(at("2026-11-06T21:30:00Z"), at("2026-11-06T21:44:59Z"));
        assert !QuarterClock.sameSlot(at("2026-11-06T21:30:00Z"), at("2026-11-06T21:45:00Z"));
        assert QuarterClock.warning(at("2026-11-06T21:30:00Z"), at("2026-11-06T21:00:00Z"), 20, false, zone)
            .equals("网络未连接，截至 14:30 已 30 分钟未更新，请充电");
        assert QuarterClock.warning(at("2026-11-06T21:30:00Z"), at("2026-11-06T21:15:01Z"), 21, true, zone).isEmpty();
        assert ConnectionSettings.endpoint(" http://192.168.1.20:8080/ ").equals("http://192.168.1.20:8080");
        assert ConnectionSettings.token("a".repeat(24)).length() == 24;
        for (String invalid : new String[] {"file:///tmp/data", "https://user:pass@host", "https://host/path",
                 "https://host?token=x", "https://host#x", "http://host:70000"}) {
            try {
                ConnectionSettings.endpoint(invalid);
                throw new AssertionError("Invalid endpoint accepted");
            } catch (AssertionError e) {
                throw e;
            } catch (Exception expected) {
            }
        }
        for (String invalid : new String[] {"short", "a".repeat(24) + "\r\nHeader: value", "a".repeat(257)}) {
            try {
                ConnectionSettings.token(invalid);
                throw new AssertionError("Invalid token accepted");
            } catch (AssertionError e) {
                throw e;
            } catch (Exception expected) {
            }
        }
        System.out.println("Java quarter boundaries, DST, duplicate slots and alert formatting passed.");
    }
}
