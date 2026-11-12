package dev.monocalendar.rp1;

import java.net.URI;

/** Validation shared by the settings form and shell-only provisioning receiver. */
public final class ConnectionSettings {
    private ConnectionSettings() {
    }
    public static String endpoint(String raw) throws Exception {
        if (raw == null)
            throw new Exception();
        String value = raw.trim().replaceAll("/+$", "");
        URI uri = new URI(value);
        if (value.length() > 2048)
            throw new Exception();
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())))
            throw new Exception();
        if (uri.getHost() == null)
            throw new Exception();
        if (uri.getRawUserInfo() != null)
            throw new Exception();
        if (uri.getRawQuery() != null)
            throw new Exception();
        if (uri.getRawFragment() != null)
            throw new Exception();
        if (!(uri.getRawPath() == null || uri.getRawPath().isEmpty()))
            throw new Exception();
        if (uri.getPort() == 0 || uri.getPort() > 65535)
            throw new Exception();
        return value;
    }
    public static String token(String raw) throws Exception {
        if (raw == null)
            throw new Exception();
        String value = raw.trim();
        if (!value.matches("[!-~]{24,256}"))
            throw new Exception();
        return value;
    }
}
