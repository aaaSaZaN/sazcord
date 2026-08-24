package vip.sazcord.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Фоновый наблюдатель входящих звонков.
 *
 * Зачем: пока приложение закрыто, WebView мёртв, а web-push внутри
 * WebView не работает (service worker'ы там не живут). Единственный
 * способ узнать о звонке без Google-инфраструктуры (FCM) — держать
 * своё соединение с сервером. Этот foreground-сервис держит websocket
 * к socket.io и при call:invite поднимает полноэкранное уведомление,
 * как в Discord.
 *
 * Протокол socket.io поверх websocket (engine.io v4) говорим руками,
 * клиент нужен ровно один и тащить ради него socket.io-client ради
 * трёх пакетов смысла нет:
 *   сервер → «0{sid…}»  (engine open)
 *   клиент → «40{"token":…}» (CONNECT namespace + auth)
 *   сервер → «40{…}» (namespace ok)
 *   сервер → «2» ping, клиент отвечает «3» pong
 *   события → «42["call:invite",{…}]»
 *
 * Токен и адрес сервера пишет веб-клиент через мост
 * (window.SazcordAndroid.setCallWatch, см. AuthContext → mobile.ts).
 * Если токен протух, сервер рвёт соединение сразу после handshake —
 * в этом случае сервис останавливается до следующего логина.
 *
 * Компромисс осознанный: постоянное соединение ест батарею сильнее
 * push'а, но для self-hosted без Google-аккаунта это стандартная цена
 * (так работают, например, XMPP-клиенты).
 */
public class CallListenerService extends android.app.Service {

    private static final String TAG = "SazcordCallWatch";
    private static final String PREFS = "sazcord_watch";
    private static final String KEY_SERVER = "server";
    private static final String KEY_TOKEN = "token";

    private static final String CHANNEL_WATCH = "sazcord_watch";
    private static final String CHANNEL_INCOMING = "sazcord_incoming";
    private static final int FOREGROUND_ID = 43;
    private static final int INCOMING_ID = 44;
    private static final long MAX_BACKOFF_MS = 60_000;

    private static volatile boolean running = false;

    private final Handler main = new Handler(Looper.getMainLooper());
    private OkHttpClient http;
    private WebSocket ws;
    private long backoffMs = 2_000;
    private boolean wantRun = false;
    private boolean authFailed = false;
    private boolean namespaceReady = false;
    private String activeCallId = null;
    private String activeFromId = null;

    // --- Публичное API для моста ------------------------------------------

    /** Включить наблюдателя (server+token) или выключить (token пустой). */
    public static void setWatch(Context ctx, String serverUrl, String token) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean has = token != null && !token.isEmpty()
                && serverUrl != null && !serverUrl.isEmpty();
        p.edit()
                .putString(KEY_SERVER, has ? serverUrl : "")
                .putString(KEY_TOKEN, has ? token : "")
                .apply();
        Intent i = new Intent(ctx, CallListenerService.class);
        if (has) {
            if (running) {
                // Перезапускаем соединение, чтобы перечитать новые prefs
                // (например, после релогина с новым токеном).
                ctx.stopService(i);
            }
            ContextCompat.startForegroundService(ctx, i);
        } else {
            ctx.stopService(i);
        }
    }

    // --- Жизненный цикл ----------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "decline".equals(intent.getAction())) {
            declineActive(intent.getStringExtra("callId"));
            return START_STICKY;
        }
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        wantRun = !p.getString(KEY_TOKEN, "").isEmpty()
                && !p.getString(KEY_SERVER, "").isEmpty();
        if (!wantRun) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForegroundCompat();
        running = true;
        connect();
        // START_STICKY: если система прибила процесс — перезапустит сервис,
        // и он снова подключится по сохранённым prefs.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        wantRun = false;
        main.removeCallbacksAndMessages(null);
        if (ws != null) {
            ws.cancel();
            ws = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // --- Соединение --------------------------------------------------------

    private synchronized void connect() {
        if (!wantRun) return;
        String server = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_SERVER, "").replaceAll("/+$", "");
        String token = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_TOKEN, "");
        if (server.isEmpty() || token.isEmpty()) {
            stopSelf();
            return;
        }
        authFailed = false;
        namespaceReady = false;
        if (http == null) {
            http = new OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .pingInterval(0, TimeUnit.SECONDS) // engine.io-пинги отвечаем руками
                    .build();
        }
        Request req = new Request.Builder()
                .url(server + "/socket.io/?EIO=4&transport=websocket")
                .build();
        ws = http.newWebSocket(req, new WebSocketListener() {
            @Override
            public void onMessage(WebSocket webSocket, String text) {
                handlePacket(text);
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, @Nullable Response response) {
                scheduleReconnect();
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                scheduleReconnect();
            }
        });
    }

    private void handlePacket(String text) {
        if (text == null || text.isEmpty()) return;
        try {
            if (text.charAt(0) == '0') {
                // engine.io open → коннектимся к default namespace с токеном.
                sawEngineOpen = true;
                JSONObject auth = new JSONObject();
                auth.put("token", getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .getString(KEY_TOKEN, ""));
                if (ws != null) ws.send("40" + auth.toString());
                return;
            }
            if (text.startsWith("42")) {
                handleEvent(text.substring(2));
                return;
            }
            if (text.startsWith("40")) {
                // namespace connected — можно верить событиям.
                namespaceReady = true;
                backoffMs = 2_000;
                Log.i(TAG, "connected to call stream");
                return;
            }
            if (text.startsWith("41")) {
                // namespace disconnected — пересобираем соединение.
                scheduleReconnect();
                return;
            }
            if (text.startsWith("2") && ws != null) {
                ws.send("3"); // engine.io ping → pong
            }
        } catch (Exception e) {
            Log.w(TAG, "packet parse failed", e);
        }
    }

    private void handleEvent(String json) {
        try {
            JSONArray arr = new JSONArray(json);
            if (arr.length() == 0) return;
            String event = arr.getString(0);
            JSONObject payload = arr.length() > 1 ? arr.optJSONObject(1) : new JSONObject();
            if (payload == null) payload = new JSONObject();
            switch (event) {
                case "call:invite":
                    onInvite(payload);
                    break;
                case "call:cancel":
                case "call:end":
                case "call:reject":
                case "call:handled":
                    String endedId = payload.optString("callId", null);
                    if (endedId != null && endedId.equals(activeCallId)) {
                        cancelIncoming();
                    }
                    break;
                default:
                    break;
            }
        } catch (Exception e) {
            Log.w(TAG, "event parse failed", e);
        }
    }

    private void onInvite(JSONObject payload) {
        // Пока приложение на экране — модалку показывает веб-клиент,
        // дублировать системным уведомлением не нужно.
        if (MainActivity.activityVisible) return;
        try {
            String callId = payload.optString("callId", null);
            if (callId == null) return;
            activeCallId = callId;
            activeFromId = payload.optString("from", null);
            String name = payload.optString("fromDisplayName", null);
            if (name == null || name.isEmpty()) name = payload.optString("fromUsername", "Звонок");
            boolean video = payload.optBoolean("withVideo");

            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent openPi = PendingIntent.getActivity(
                    this, 0, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent decline = new Intent(this, CallListenerService.class)
                    .setAction("decline")
                    .putExtra("callId", callId);
            PendingIntent declinePi = PendingIntent.getService(
                    this, 1, decline,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                b = new Notification.Builder(this, CHANNEL_INCOMING);
            } else {
                b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MAX);
            }
            b.setContentTitle(name)
                    .setContentText(video ? "Видеозвонок" : "Голосовой звонок")
                    .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                    .setCategory(Notification.CATEGORY_CALL)
                    .setOngoing(true)
                    .setContentIntent(openPi)
                    .addAction(0, "Ответить", openPi)
                    .addAction(0, "Отклонить", declinePi);
            // Полноэкранный запуск на заблокированном экране — как в Discord.
            // Без разрешения USE_FULL_SCREEN_INTENT система сама откатит
            // к heads-up уведомлению, ничего не сломается.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                b.setFullScreenIntent(openPi, true);
            }
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(INCOMING_ID, b.build());
        } catch (Exception e) {
            Log.w(TAG, "invite notify failed", e);
        }
    }

    private void declineActive(String callId) {
        if (ws == null || callId == null || !callId.equals(activeCallId)) {
            cancelIncoming();
            return;
        }
        try {
            JSONObject p = new JSONObject();
            p.put("callId", callId);
            if (activeFromId != null) p.put("to", activeFromId);
            JSONArray ev = new JSONArray().put("call:reject").put(p);
            ws.send("42" + ev.toString());
        } catch (Exception ignored) {
            // Сервер сам погасит invite по таймауту, если не ушли.
        }
        cancelIncoming();
    }

    private void cancelIncoming() {
        activeCallId = null;
        activeFromId = null;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(INCOMING_ID);
    }

    private void scheduleReconnect() {
        if (!wantRun || !running) return;
        if (!namespaceReady && sawEngineOpen) {
            // Движок открылся, но namespace не приняли: сервер отверг токен
            // (просрочен/отозван). Реконнект бессмысленен до нового логина —
            // веб-клиент при нём сам перезапустит наблюдателя.
            Log.i(TAG, "auth rejected, stopping until next login");
            authFailed = true;
            stopSelf();
            return;
        }
        long delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        main.postDelayed(this::connect, delay);
    }

    private boolean sawEngineOpen = false;

    // --- Уведомления и каналы ----------------------------------------------

    private void startForegroundCompat() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, CHANNEL_WATCH);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        Notification n = b
                .setContentTitle("Sazcord")
                .setContentText("Ожидаю звонки")
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(FOREGROUND_ID, n,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(FOREGROUND_ID, n);
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel watch = new NotificationChannel(
                CHANNEL_WATCH, "Фоновый режим", NotificationManager.IMPORTANCE_MIN);
        watch.setDescription("Держит соединение для входящих звонков, когда приложение закрыто");
        watch.setShowBadge(false);
        nm.createNotificationChannel(watch);

        NotificationChannel incoming = new NotificationChannel(
                CHANNEL_INCOMING, "Входящие звонки", NotificationManager.IMPORTANCE_HIGH);
        incoming.setDescription("Полноэкранное уведомление о входящем звонке");
        incoming.enableVibration(true);
        try {
            Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            incoming.setSound(ring, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        } catch (Exception ignored) {
            // Без звука всё равно покажется heads-up.
        }
        nm.createNotificationChannel(incoming);
    }
}
