package dev.monocalendar.rp1;

import android.app.Activity;
import android.content.*;
import java.util.UUID;

/** Exported only behind DUMP, a system permission held by the ADB shell. */
public final class SetupReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if ("dev.monocalendar.rp1.EXIT".equals(intent.getAction())) {
            if (WakeReceiver.setExited(context, true)) {
                MainActivity.finishActive();
                setResultCode(Activity.RESULT_OK);
                setResultData("exited");
            } else {
                setResultCode(Activity.RESULT_CANCELED);
                setResultData("Exit could not be saved");
            }
            return;
        }
        if ("dev.monocalendar.rp1.RESTART".equals(intent.getAction())) {
            if (!WakeReceiver.setExited(context, false)) {
                setResultCode(Activity.RESULT_CANCELED);
                return;
            }
            context.startActivity(new Intent(context, MainActivity.class)
                                      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            setResultCode(Activity.RESULT_OK);
            setResultData("restarted");
            return;
        }
        if (!"dev.monocalendar.rp1.CONFIGURE".equals(intent.getAction()))
            return;
        try {
            String endpoint = ConnectionSettings.endpoint(intent.getStringExtra("endpoint"));
            String token = ConnectionSettings.token(intent.getStringExtra("token"));
            SharedPreferences preferences = context.getSharedPreferences("connection", Context.MODE_PRIVATE);
            boolean connectionChanged = !endpoint.equals(preferences.getString("endpoint", ""))
                || !token.equals(preferences.getString("token", ""));
            SharedPreferences.Editor editor = preferences.edit()
                                                  .putString("endpoint", endpoint)
                                                  .putString("token", token)
                                                  .putBoolean("scheduled", intent.getBooleanExtra("scheduled", true))
                                                  .putBoolean("exited", false);
            if (connectionChanged)
                editor.putString("client", UUID.randomUUID().toString())
                    .putLong("last_data", 0)
                    .putLong("last_check", System.currentTimeMillis())
                    .remove("etag")
                    .putBoolean("last_network_ok", false);
            if (!editor.commit())
                throw new Exception();
            if (connectionChanged) {
                MainActivity.finishActive();
                MainActivity.clearCache(context);
            }
            WakeReceiver.schedule(context);
            context.startActivity(new Intent(context, MainActivity.class)
                                      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            setResultCode(Activity.RESULT_OK);
            setResultData("configured");
        } catch (Exception failure) {
            setResultCode(Activity.RESULT_CANCELED);
            setResultData("Invalid connection settings");
        } finally {
            intent.removeExtra("endpoint");
            intent.removeExtra("token");
            intent.removeExtra("scheduled");
        }
    }
}
