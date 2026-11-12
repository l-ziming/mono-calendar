package dev.monocalendar.rp1;

import android.app.IntentService;
import android.content.Intent;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Runs in its own ":sync" process: one GET /data per quarter (or 刷新), 15 s at most, then idle.
 * A crash or hang here never touches the display process. It never changes Wi-Fi state.
 */
public final class SyncService extends IntentService {
    public static final String DONE = "dev.monocalendar.rp1.SYNCED";
    static final String FILE = "data.json";
    static String pending(long requestId) {
        return FILE + ".sync." + requestId;
    }
    public SyncService() {
        super("rp1-sync");
    }

    @Override
    protected void onHandleIntent(Intent request) {
        if (request == null)
            return;
        String endpoint = request.getStringExtra("endpoint");
        String token = request.getStringExtra("token");
        String etag = request.getStringExtra("etag");
        long started = System.currentTimeMillis();
        long deadline = started + 15000;
        long requestId = request.getLongExtra("requestId", 0);
        Intent result =
            new Intent(DONE).setPackage(getPackageName()).putExtra("started", started).putExtra("requestId", requestId);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint + "/data").openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Connection", "close");
            if (etag != null && !etag.isEmpty())
                connection.setRequestProperty("If-None-Match", etag);
            int code = connection.getResponseCode();
            result.putExtra("code", code).putExtra("dataTime", parseDataTime(connection.getHeaderField("X-Data-Time")));
            if (code == 200) {
                byte[] body = readBytes(connection.getInputStream(), 2_000_000, deadline);
                Json.parse(new String(body, "UTF-8"));
                File pendingFile = new File(getFilesDir(), pending(requestId));
                try (FileOutputStream output = new FileOutputStream(pendingFile)) {
                    output.write(body);
                    output.getFD().sync();
                }
                result.putExtra("etag", connection.getHeaderField("ETag"));
            }
        } catch (Exception failure) {
            result.putExtra("code", -1);
        } finally {
            if (connection != null)
                connection.disconnect();
            result.putExtra("finished", System.currentTimeMillis());
            sendBroadcast(result);
        }
    }
    static long parseDataTime(String headerValue) {
        try {
            return headerValue == null ? 0 : Long.parseLong(headerValue.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
    static byte[] readBytes(InputStream in, int limit, long deadline) throws IOException {
        try (InputStream input = in; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int bytesRead;
            int total = 0;
            while ((bytesRead = input.read(buffer)) != -1) {
                total += bytesRead;
                if (total > limit || System.currentTimeMillis() > deadline)
                    throw new IOException("response");
                output.write(buffer, 0, bytesRead);
            }
            return output.toByteArray();
        }
    }
}
