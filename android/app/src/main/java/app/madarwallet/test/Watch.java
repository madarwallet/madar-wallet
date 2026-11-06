package app.madarwallet.test;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class Watch {
    static final String PREFS = "madar-watch";
    static final String KEY = "plan";
    static final int JOB_ID = 4801;
    static final String CHANNEL = "madar-wallet";
    private static final long TX_MAX_AGE = 24L * 3600_000L;
    private static final int DONE_MAX = 200;
    private static final Object LOCK = new Object();

    private Watch() {}

    static void setPlan(Context c, String json) {
        synchronized (LOCK) {
            SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JobScheduler js = c.getSystemService(JobScheduler.class);
            JSONObject fresh = null;
            try { if (json != null && !json.isEmpty()) fresh = new JSONObject(json); } catch (Exception e) { fresh = null; }
            if (fresh == null || !fresh.optBoolean("on")) {
                p.edit().remove(KEY).apply();
                if (js != null) js.cancel(JOB_ID);
                return;
            }
            try {
                String old = p.getString(KEY, null);
                if (old != null) {
                    JSONObject o = new JSONObject(old);
                    Set<String> done = new LinkedHashSet<>();
                    addAll(done, o.optJSONArray("done"));
                    addAll(done, fresh.optJSONArray("done"));
                    JSONArray txs = new JSONArray();
                    JSONArray ft = fresh.optJSONArray("txs");
                    for (int i = 0; ft != null && i < ft.length(); i++) if (!done.contains(ft.getJSONObject(i).optString("hash"))) txs.put(ft.getJSONObject(i));
                    fresh.put("txs", txs);
                    fresh.put("done", tail(done));
                }
            } catch (Exception ignored) {  }
            p.edit().putString(KEY, fresh.toString()).apply();
        }
        schedule(c);
    }

    static void ensure(Context c) {
        String s = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        if (s != null) schedule(c);
    }

    private static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        JobInfo ji = new JobInfo.Builder(JOB_ID, new ComponentName(c, WatchJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15L * 60_000L)
                .setPersisted(true)
                .build();
        js.schedule(ji);
    }

    static void run(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String before = p.getString(KEY, null);
        if (before == null) return;
        List<String[]> events = new ArrayList<>();
        JSONObject plan;
        try {
            plan = new JSONObject(before);
            if (!plan.optBoolean("on")) return;
            JSONObject texts = plan.getJSONObject("texts");
            JSONArray coins = plan.getJSONArray("coins");
            for (int i = 0; i < coins.length(); i++) {
                JSONObject coin = coins.getJSONObject(i);
                BigInteger v;
                try { v = readCoin(coin); } catch (Exception e) { continue; }
                if (!coin.isNull("last")) {
                    try {
                        BigInteger was = new BigInteger(coin.getString("last"));
                        if (v.compareTo(was) > 0) {
                            String body = texts.optString("inBody").replace("{a}", unitsText(v.subtract(was), coin.optInt("decimals")))
                                    .replace("{s}", coin.optString("symbol")).replace("{n}", coin.optString("net"));
                            events.add(new String[] { "in:" + coin.optString("id") + ":" + v, texts.optString("inTitle"), body });
                        }
                    } catch (Exception ignored) {  }
                }
                coin.put("last", v.toString());
            }
            Set<String> done = new LinkedHashSet<>();
            addAll(done, plan.optJSONArray("done"));
            JSONArray keep = new JSONArray();
            JSONArray txs = plan.optJSONArray("txs");
            long now = System.currentTimeMillis();
            for (int i = 0; txs != null && i < txs.length(); i++) {
                JSONObject x = txs.getJSONObject(i);
                String hash = x.optString("hash");
                if (done.contains(hash)) continue;
                String st = null;
                try { st = readTx(x); } catch (Exception ignored) {  }
                if (st != null) {
                    events.add(new String[] { "tx:" + hash, "ok".equals(st) ? texts.optString("okTitle") : texts.optString("failTitle"), x.optString("label") });
                    done.add(hash);
                } else if (now - x.optLong("at") < TX_MAX_AGE) keep.put(x);
            }
            plan.put("txs", keep);
            plan.put("done", tail(done));
            plan.put("at", now);
        } catch (Exception e) {
            return;
        }
        synchronized (LOCK) {
            String cur = p.getString(KEY, null);
            if (cur == null) return;
            if (cur.equals(before)) p.edit().putString(KEY, plan.toString()).apply();
            else {
                try {
                    JSONObject n = new JSONObject(cur);
                    Set<String> done = new LinkedHashSet<>();
                    addAll(done, n.optJSONArray("done"));
                    addAll(done, plan.optJSONArray("done"));
                    n.put("done", tail(done));
                    p.edit().putString(KEY, n.toString()).apply();
                } catch (Exception ignored) {  }
            }
        }
        for (String[] e : events) show(c, e[0], e[1], e[2]);
    }

    private static BigInteger readCoin(JSONObject c) throws Exception {
        String kind = c.optString("kind");
        JSONArray urls = c.getJSONArray("urls");
        String addr = c.getString("address");
        if ("evm".equals(kind)) {
            JSONArray params = new JSONArray();
            if (c.isNull("token") || c.optString("token").isEmpty()) {
                params.put(addr).put("latest");
                return hex(rpc(urls, "eth_getBalance", params));
            }
            String data = "0x70a08231" + pad64(addr.toLowerCase().replaceFirst("^0x", ""));
            params.put(new JSONObject().put("to", c.getString("token")).put("data", data)).put("latest");
            return hex(rpc(urls, "eth_call", params));
        }
        if ("sol".equals(kind)) {
            JSONArray params = new JSONArray().put(addr).put(new JSONObject().put("commitment", "confirmed"));
            Object r = rpc(urls, "getBalance", params);
            return BigInteger.valueOf(((JSONObject) r).getLong("value"));
        }
        if ("btc".equals(kind)) {
            JSONObject r = new JSONObject(rest(urls, "/address/" + addr));
            return sum(r.optJSONObject("chain_stats")).add(sum(r.optJSONObject("mempool_stats")));
        }
        throw new Exception("kind");
    }

    private static String readTx(JSONObject x) throws Exception {
        String kind = x.optString("kind");
        JSONArray urls = x.getJSONArray("urls");
        String hash = x.getString("hash");
        if ("evm".equals(kind)) {
            Object r = rpc(urls, "eth_getTransactionReceipt", new JSONArray().put(hash));
            if (!(r instanceof JSONObject)) return null;
            String s = ((JSONObject) r).optString("status");
            return "0x1".equals(s) ? "ok" : "0x0".equals(s) ? "failed" : null;
        }
        if ("sol".equals(kind)) {
            Object r = rpc(urls, "getSignatureStatuses", new JSONArray().put(new JSONArray().put(hash)).put(new JSONObject().put("searchTransactionHistory", true)));
            JSONArray v = r instanceof JSONObject ? ((JSONObject) r).optJSONArray("value") : null;
            JSONObject s = v != null && v.length() > 0 ? v.optJSONObject(0) : null;
            if (s == null) return null;
            if (!s.isNull("err")) return "failed";
            String cs = s.optString("confirmationStatus");
            return "confirmed".equals(cs) || "finalized".equals(cs) ? "ok" : null;
        }
        if ("btc".equals(kind)) {
            JSONObject r = new JSONObject(rest(urls, "/tx/" + hash + "/status"));
            return r.optBoolean("confirmed") ? "ok" : null;
        }
        return null;
    }

    private static Object rpc(JSONArray urls, String method, JSONArray params) throws Exception {
        Exception last = new Exception("no node");
        String body = new JSONObject().put("jsonrpc", "2.0").put("id", 1).put("method", method).put("params", params).toString();
        for (int i = 0; i < urls.length(); i++) {
            try {
                JSONObject j = new JSONObject(http(urls.getString(i), body));
                if (j.has("error") && !j.isNull("error")) { last = new Exception("rpc"); continue; }
                return j.opt("result");
            } catch (Exception e) { last = e; }
        }
        throw last;
    }

    private static String rest(JSONArray bases, String path) throws Exception {
        Exception last = new Exception("no api");
        for (int i = 0; i < bases.length(); i++) {
            try { return http(bases.getString(i) + path, null); } catch (Exception e) { last = e; }
        }
        throw last;
    }

    private static String http(String url, String post) throws Exception {
        if (!url.startsWith("https://")) throw new Exception("https only");
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(8000);
        h.setReadTimeout(8000);
        h.setUseCaches(false);
        try {
            if (post != null) {
                h.setRequestMethod("POST");
                h.setDoOutput(true);
                h.setRequestProperty("Content-Type", "application/json");
                byte[] b = post.getBytes(StandardCharsets.UTF_8);
                try (OutputStream o = h.getOutputStream()) { o.write(b); }
            }
            if (h.getResponseCode() / 100 != 2) throw new Exception("HTTP " + h.getResponseCode());
            try (InputStream in = h.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n, total = 0;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > 2 * 1024 * 1024) throw new Exception("too big");
                    out.write(buf, 0, n);
                }
                return out.toString("UTF-8");
            }
        } finally { h.disconnect(); }
    }

    private static BigInteger hex(Object o) throws Exception {
        String s = String.valueOf(o);
        if (!s.matches("^0x[0-9a-fA-F]*$")) throw new Exception("bad");
        return s.length() == 2 ? BigInteger.ZERO : new BigInteger(s.substring(2), 16);
    }
    private static String pad64(String h) { StringBuilder b = new StringBuilder(); for (int i = h.length(); i < 64; i++) b.append('0'); return b.append(h).toString(); }
    private static BigInteger sum(JSONObject s) {
        if (s == null) return BigInteger.ZERO;
        return BigInteger.valueOf(Math.round(s.optDouble("funded_txo_sum", 0) - s.optDouble("spent_txo_sum", 0)));
    }

    static String unitsText(BigInteger v, int decimals) {
        BigDecimal d = new BigDecimal(v).movePointLeft(decimals);
        BigDecimal six = d.setScale(6, RoundingMode.DOWN);
        BigDecimal out = six.signum() == 0 && v.signum() != 0 ? d : six;
        out = out.stripTrailingZeros();
        return out.signum() == 0 ? "0" : out.toPlainString();
    }
    private static void addAll(Set<String> s, JSONArray a) { for (int i = 0; a != null && i < a.length(); i++) s.add(a.optString(i)); }
    private static JSONArray tail(Set<String> s) {
        List<String> l = new ArrayList<>(s);
        JSONArray a = new JSONArray();
        for (int i = Math.max(0, l.size() - DONE_MAX); i < l.size(); i++) a.put(l.get(i));
        return a;
    }

    private static void show(Context c, String key, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Madar Wallet", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder pub = new NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_madar).setContentTitle("Madar Wallet");
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_madar)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(pub.build());
        try { NotificationManagerCompat.from(c).notify(key.hashCode(), b.build()); } catch (SecurityException ignored) {  }
    }
}
