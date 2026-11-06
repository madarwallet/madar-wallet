package app.madarwallet.test;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.android.gms.common.moduleinstall.ModuleInstall;
import com.google.android.gms.common.moduleinstall.ModuleInstallClient;
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String START = ORIGIN + "/index.html";
    private static final int REQ_PICK = 1;
    private static final int REQ_SAVE = 2;
    private static final int REQ_NOTIFY = 3;
    private static final int MAX_PROXY_BYTES = 4 * 1024 * 1024;
    private JavaScriptReplyProxy notifyReply;

    private WebView web;
    private WebViewAssetLoader loader;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSave;
    private JavaScriptReplyProxy updateReply;
    private UpdateManager updater;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF050506);
        web = new WebView(this);
        web.setBackgroundColor(0xFF050506);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> moveTaskToBack(true));
        }
        if (Build.VERSION.SDK_INT >= 35) {

            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        updater = new UpdateManager(this, json -> { if (updateReply != null && web != null) updateReply.postMessage(json); });
        loader = new WebViewAssetLoader.Builder().setDomain(HOST).addPathHandler("/", this::asset).build();
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "MadarAndroid", Collections.singleton(ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (isMainFrame && ORIGIN.equals(sourceOrigin.toString().replaceAll("/$", ""))) onMessage(message.getData(), reply);
                    });
        }
        web.loadUrl(START);
        Watch.ensure(this);
    }

    private WebResourceResponse asset(String path) {
        if (path.isEmpty()) path = "index.html";
        if (path.contains("..") || path.startsWith("/") || path.contains("\\")) return notFound();
        try {
            InputStream in = getAssets().open("www/" + path);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            h.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime(path), null, 200, "OK", h, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse forbidden() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private static boolean proxied(Uri u) {
        if (!"https".equals(u.getScheme()) || u.getPort() != -1) return false;
        String host = u.getHost(), path = u.getPath();

        if ("madarwallet.app".equals(host)) return "/wallet-api/history".equals(path)
            || (path != null && path.matches("/wallet-api/cg/[A-Za-z0-9/_-]{1,200}"));

        if ("swap.madarwallet.app".equals(host)) return "/lifi/quote".equals(path) || "/lifi/status".equals(path) || "/mayan/quote".equals(path)
            || (path != null && path.matches("/mayan/status/[1-9A-HJ-NP-Za-km-z]{64,90}"));
        return false;
    }

    private static WebResourceResponse fetchForPage(Uri u) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", ORIGIN);
        h.put("Cache-Control", "no-store");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(u.toString()).openConnection();
            c.setRequestMethod("GET");
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(35000);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            if (code < 200 || (code >= 300 && code < 400) || code > 599) return error(h);
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (in != null) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_PROXY_BYTES) return error(h);
                }
                in.close();
            }
            String type = c.getContentType() == null ? "application/json" : c.getContentType().split(";")[0].trim();
            String reason = c.getResponseMessage();
            if (reason == null || reason.isEmpty()) reason = code < 400 ? "OK" : "Error";
            return new WebResourceResponse(type, "utf-8", code, reason, h, new ByteArrayInputStream(out.toByteArray()));
        } catch (IOException | RuntimeException e) {
            return error(h);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static WebResourceResponse error(Map<String, String> h) {
        return new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", h, new ByteArrayInputStream(new byte[0]));
    }

    private static boolean isOwn(Uri u) {
        return "https".equals(u.getScheme()) && HOST.equals(u.getHost());
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (isOwn(u)) return loader.shouldInterceptRequest(u);

            if (req.isForMainFrame()) return forbidden();
            if ("GET".equals(req.getMethod()) && proxied(u)) return fetchForPage(u);
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            if (!req.isForMainFrame()) return false;
            Uri u = req.getUrl();
            if (isOwn(u)) return false;
            openExternal(u);
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {

            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
            view.destroy();
            web = null;
            recreate();
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(i, null), REQ_PICK);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }
    }

    private void startScan(GmsBarcodeScanner sc, JavaScriptReplyProxy reply) {
        sc.startScan()
                .addOnSuccessListener(b -> {
                    String raw = b.getRawValue();
                    boolean ok = raw != null && raw.length() <= 2048;
                    reply.postMessage("{\"t\":\"scan\",\"ok\":" + ok + (ok ? ",\"text\":" + JSONObject.quote(raw) : ",\"err\":\"empty\"") + "}");
                })
                .addOnCanceledListener(() -> reply.postMessage("{\"t\":\"scan\",\"ok\":false,\"err\":\"cancel\"}"))
                .addOnFailureListener(e -> reply.postMessage("{\"t\":\"scan\",\"ok\":false,\"err\":\"failed\"}"));
    }

    private void onMessage(String data, JavaScriptReplyProxy reply) {
        try {
            JSONObject m = new JSONObject(data);
            switch (m.optString("t")) {
                case "update-check":
                    updateReply = reply;
                    updater.check(m.optBoolean("force"));
                    break;
                case "update-start":
                    updateReply = reply;
                    updater.start();
                    break;
                case "open":
                    openExternal(Uri.parse(m.optString("url")));
                    break;
                case "scan": {

                    GmsBarcodeScannerOptions o = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
                    GmsBarcodeScanner sc = GmsBarcodeScanning.getClient(this, o);
                    ModuleInstallClient mic = ModuleInstall.getClient(this);
                    mic.areModulesAvailable(sc)
                            .addOnSuccessListener(r -> {
                                if (r.areModulesAvailable()) { startScan(sc, reply); return; }
                                reply.postMessage("{\"t\":\"scan\",\"ok\":false,\"err\":\"preparing\"}");
                                mic.installModules(ModuleInstallRequest.newBuilder().addApi(sc).build());
                            })
                            .addOnFailureListener(e -> reply.postMessage("{\"t\":\"scan\",\"ok\":false,\"err\":\"unavailable\"}"));
                    break;
                }
                case "notify-perm": {

                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        notifyReply = reply;
                        requestPermissions(new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
                    } else {
                        android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
                        reply.postMessage("{\"t\":\"notify-perm\",\"ok\":" + (nm == null || nm.areNotificationsEnabled()) + "}");
                    }
                    break;
                }
                case "watch":

                    Watch.setPlan(getApplicationContext(), m.optString("plan"));
                    break;
                case "copy": {
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Madar", m.optString("text")));
                    break;
                }
                case "save": {

                    pendingSave = m.optString("data");
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/octet-stream");
                    i.putExtra(Intent.EXTRA_TITLE, m.optString("name", "madar-wallet.madarbackup"));
                    startActivityForResult(i, REQ_SAVE);
                    break;
                }
                default:
                    break;
            }
        } catch (Exception e) {
            pendingSave = null;
        }
    }

    private void openExternal(Uri u) {
        String scheme = u.getScheme();
        Intent i;
        if ("https".equals(scheme)) i = new Intent(Intent.ACTION_VIEW, u);
        else if ("mailto".equals(scheme)) i = new Intent(Intent.ACTION_SENDTO, u);
        else return;
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        if ("mailto".equals(scheme)) i.removeCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != REQ_NOTIFY || notifyReply == null) return;
        boolean ok = results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
        notifyReply.postMessage("{\"t\":\"notify-perm\",\"ok\":" + ok + "}");
        notifyReply = null;
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == REQ_PICK) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        } else if (request == REQ_SAVE) {
            String content = pendingSave;
            pendingSave = null;
            if (result != RESULT_OK || data == null || data.getData() == null || content == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "w")) {
                if (out == null) throw new IOException("no stream");
                out.write(content.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
            } catch (IOException | SecurityException e) {
                Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (updater != null) updater.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
