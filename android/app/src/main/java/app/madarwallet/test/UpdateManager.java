package app.madarwallet.test;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.regex.Pattern;

final class UpdateManager {
    private static final String HOST = "madarwallet.app";
    private static final String BASE = "https://" + HOST + "/wallet/android/";
    private static final String LATEST = BASE + "latest.json";
    private static final long SIX_HOURS = 6L * 60 * 60 * 1000;
    private static final long MAX_APK = 150L * 1024 * 1024;
    private static final Pattern NAME = Pattern.compile("^[0-9A-Za-z.\\-]{1,32}$");
    private static final Pattern HEX64 = Pattern.compile("^[0-9a-f]{64}$");
    private static final String APK_TYPE = "application/vnd.android.package-archive";

    private final Activity act;
    private final Consumer<String> send;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final SharedPreferences prefs;
    private JSONObject offer;
    private File ready;
    private volatile boolean busy;
    private boolean awaitingPermission;

    UpdateManager(Activity act, Consumer<String> send) {
        this.act = act;
        this.send = send;
        this.prefs = act.getSharedPreferences("update", Context.MODE_PRIVATE);
    }

    void check(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - prefs.getLong("at", 0) < SIX_HOURS) {

            try {
                String cached = prefs.getString("json", null);
                if (cached != null) {
                    JSONObject j = validate(new JSONObject(cached));
                    if (j.getLong("versionCode") > installedCode()) { offer = j; post("available", j); }
                }
            } catch (Exception ignored) {  }
            return;
        }
        io.execute(() -> {
            try {
                JSONObject j = validate(new JSONObject(new String(get(LATEST, 64 * 1024), "UTF-8")));
                prefs.edit().putLong("at", System.currentTimeMillis()).putString("json", j.toString()).apply();
                if (j.getLong("versionCode") > installedCode()) { offer = j; post("available", j); }
                else { offer = null; post("none", null); }
            } catch (IOException e) {
                if (force) error("net");
            } catch (Exception e) {
                if (force) error("bad");
            }
        });
    }

    private static JSONObject validate(JSONObject j) throws JSONException {
        long code = j.getLong("versionCode");
        String name = j.getString("versionName"), sha = j.getString("sha256").toLowerCase(Locale.ROOT), url = j.getString("url");
        long size = j.getLong("size");
        if (code <= 0 || !NAME.matcher(name).matches() || !HEX64.matcher(sha).matches() || size <= 0 || size > MAX_APK
                || !url.startsWith(BASE) || !url.endsWith(".apk") || url.contains("..") || url.contains("?") || url.contains("#"))
            throw new JSONException("invalid latest.json");
        JSONObject out = new JSONObject();
        out.put("versionCode", code).put("versionName", name).put("size", size).put("sha256", sha).put("url", url);
        out.put("notes_ar", clip(j.optString("notes_ar", ""))).put("notes_en", clip(j.optString("notes_en", "")));
        return out;
    }

    private static String clip(String s) { return s.length() > 600 ? s.substring(0, 600) : s; }

    void start() {
        if (busy) return;
        final JSONObject j = offer;
        if (j == null) { error("bad"); return; }
        if (ready != null && ready.isFile()) { install(); return; }
        busy = true;
        io.execute(() -> {
            File dir = new File(act.getCacheDir(), "update");
            File apk = new File(dir, "madar-wallet-update.apk");
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cache");
                if (apk.exists() && !apk.delete()) throw new IOException("cache");
                long size = j.getLong("size");
                String sha = download(j.getString("url"), apk, size, j.getString("versionName"));
                postState("verifying");
                if (apk.length() != size || !sha.equals(j.getString("sha256"))) { apk.delete(); error("bad"); return; }
                String why = checkArchive(apk, j.getLong("versionCode"));
                if (why != null) { apk.delete(); error(why); return; }
                ready = apk;
                act.runOnUiThread(this::install);
            } catch (IOException e) {
                apk.delete();
                error("net");
            } catch (Exception e) {
                apk.delete();
                error("bad");
            } finally {
                busy = false;
            }
        });
    }

    private String checkArchive(File apk, long expectedCode) {
        PackageManager pm = act.getPackageManager();
        PackageInfo a = Build.VERSION.SDK_INT >= 28
                ? pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES)
                : pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNATURES);
        if (a == null) return "bad";
        if (!act.getPackageName().equals(a.packageName)) return "sign";
        long code = Build.VERSION.SDK_INT >= 28 ? a.getLongVersionCode() : a.versionCode;
        if (code != expectedCode || code <= installedCode()) return "bad";
        try {
            PackageInfo me = Build.VERSION.SDK_INT >= 28
                    ? pm.getPackageInfo(act.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES)
                    : pm.getPackageInfo(act.getPackageName(), PackageManager.GET_SIGNATURES);
            Set<String> mine = signers(me), theirs = signers(a);
            return !mine.isEmpty() && mine.equals(theirs) ? null : "sign";
        } catch (PackageManager.NameNotFoundException e) {
            return "sign";
        }
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo p) {
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= 28 && p.signingInfo != null) {
            SigningInfo si = p.signingInfo;
            sigs = si.getApkContentsSigners();
        }
        if (sigs == null || sigs.length == 0) sigs = p.signatures;
        Set<String> out = new HashSet<>();
        if (sigs != null) for (Signature s : sigs) out.add(hex(sha256(s.toByteArray())));
        return out;
    }

    private void install() {
        File apk = ready;
        if (apk == null || !apk.isFile()) { error("bad"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            awaitingPermission = true;
            postState("permission");
            Toast.makeText(act, R.string.allow_install, Toast.LENGTH_LONG).show();
            try {
                act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName())));
            } catch (ActivityNotFoundException e) {
                awaitingPermission = false;
                error("perm");
            }
            return;
        }
        Uri uri = FileProvider.getUriForFile(act, act.getPackageName() + ".updates", apk);
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_TYPE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            act.startActivity(i);
            postState("installing");
        } catch (ActivityNotFoundException e) {
            try {
                @SuppressWarnings("deprecation")
                Intent alt = new Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(alt);
                postState("installing");
            } catch (ActivityNotFoundException e2) {
                error("install");
            }
        }
    }

    void onResume() {
        if (!awaitingPermission) return;
        awaitingPermission = false;
        if (Build.VERSION.SDK_INT >= 26 && act.getPackageManager().canRequestPackageInstalls()) install();
        else error("perm");
    }

    private static HttpURLConnection open(String start) throws IOException {
        URL u = new URL(start);
        for (int hop = 0; hop < 4; hop++) {
            if (!"https".equals(u.getProtocol()) || !HOST.equals(u.getHost()) || (u.getPort() != -1 && u.getPort() != 443))
                throw new IOException("host not allowed");
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("redirect");
                u = new URL(u, loc);
                continue;
            }
            if (code != 200) { c.disconnect(); throw new IOException("HTTP " + code); }
            return c;
        }
        throw new IOException("too many redirects");
    }

    private static byte[] get(String url, int max) throws IOException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); if (out.size() > max) throw new IOException("too large"); }
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private String download(String url, File to, long size, String versionName) throws IOException, NoSuchAlgorithmException, JSONException {
        HttpURLConnection c = open(url);
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        long got = 0;
        int lastPct = -1;
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) {
                got += n;
                if (got > size) throw new JSONException("larger than latest.json says");
                out.write(buf, 0, n);
                md.update(buf, 0, n);
                int pct = (int) (got * 100 / size);
                if (pct != lastPct) {
                    lastPct = pct;
                    JSONObject m = new JSONObject().put("t", "update").put("state", "downloading").put("versionName", versionName).put("progress", pct);
                    sendJson(m);
                }
            }
        } finally {
            c.disconnect();
        }
        return hex(md.digest());
    }

    private long installedCode() {
        try {
            PackageInfo p = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return Long.MAX_VALUE;
        }
    }

    private void post(String state, JSONObject j) {
        try {
            JSONObject m = new JSONObject().put("t", "update").put("state", state);
            if (j != null) m.put("versionName", j.getString("versionName")).put("notes_ar", j.optString("notes_ar")).put("notes_en", j.optString("notes_en"));
            sendJson(m);
        } catch (JSONException ignored) { }
    }

    private void postState(String state) { post(state, null); }

    private void error(String code) {
        try {
            JSONObject m = new JSONObject().put("t", "update").put("state", "error").put("error", code);
            JSONObject j = offer;
            if (j != null) m.put("versionName", j.optString("versionName"));
            sendJson(m);
        } catch (JSONException ignored) { }
    }

    private void sendJson(JSONObject m) {
        String s = m.toString();
        act.runOnUiThread(() -> send.accept(s));
    }

    private static byte[] sha256(byte[] b) {
        try { return MessageDigest.getInstance("SHA-256").digest(b); } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }
}
