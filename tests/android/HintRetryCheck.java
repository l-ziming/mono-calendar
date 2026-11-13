import dev.monocalendar.rp1.HintRetry;
import dev.monocalendar.rp1.Json;

public class HintRetryCheck {
    public static void main(String[] args) {
        assert !HintRetry.hasLines(Json.parse("{}"));
        assert !HintRetry.hasLines(Json.parse("{\"assistant\":{\"lines\":[null,\"  \",12]}}"));
        assert HintRetry.hasLines(Json.parse("{\"assistant\":{\"lines\":[\"  hello  \"]}}"));
        long now = 1000000;
        HintRetry retry = new HintRetry(0, 0);
        retry.observe(false, false, now);
        assert retry.due == 0;
        retry.observe(false, true, now);
        assert retry.due == now + 60000;
        retry.observe(false, true, now + 10000);
        assert retry.due == now + 60000;

        // Persisted state survives process death without restarting the retry budget.
        retry = new HintRetry(retry.attempts, retry.due);
        long firstDue = retry.due;
        assert !retry.consume(firstDue, firstDue - 1);
        assert retry.consume(firstDue, firstDue);
        assert retry.attempts == 1 && retry.due == firstDue + 120000;
        assert !retry.consume(firstDue, firstDue + 1000);
        assert retry.consume(retry.due, retry.due);
        assert retry.attempts == 2 && retry.due == now + 420000;
        assert retry.consume(retry.due, retry.due);
        assert retry.attempts == 3 && retry.due == 0;
        assert !retry.consume(0, now + 500000);
        retry.observe(false, true, now + 900000);
        assert retry.due == 0; // Intentional blank hints do not wake on every quarter.

        retry.observe(true, true, now + 1000000);
        assert retry.attempts == 0 && retry.due == 0;
        retry.observe(false, true, now + 1100000);
        assert retry.due == now + 1160000;
        retry.observe(true, true, now + 1101000);
        assert retry.due == 0;
        System.out.println("Java empty-hint retries, restart, stale alarms and retry limits passed.");
    }
}
