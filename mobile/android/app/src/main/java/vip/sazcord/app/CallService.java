package vip.sazcord.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

/**
 * Foreground-сервис, живущий ровно столько, сколько идёт звонок.
 *
 * Зачем: Android агрессивно замораживает процессы фоновых приложений
 * (Doze / App Standby / cached-app freezer). Для обычного мессенджера это
 * незаметно, но у нас в WebView крутится WebRTC — как только процесс
 * усыпляют, RTP перестаёт идти и собеседник слышит тишину, а через
 * несколько минут соединение рвётся окончательно.
 *
 * Foreground-сервис с типом `microphone` — единственный поддерживаемый
 * способ сказать системе «я сейчас реально пишу звук, не трогай меня».
 * Постоянная нотификация при этом обязательна по требованиям платформы.
 *
 * Управляется из JS: window.SazcordAndroid.setCallActive(true|false),
 * см. MainActivity.Bridge и client/src/utils/mobile.ts.
 */
public class CallService extends android.app.Service {

    private static final String CHANNEL_ID = "sazcord_call";
    private static final int NOTIF_ID = 42;
    private static boolean running = false;

    public static void setActive(Context ctx, boolean active) {
        Intent i = new Intent(ctx, CallService.class);
        if (active) {
            if (running) return;
            ContextCompat.startForegroundService(ctx, i);
        } else {
            if (!running) return;
            ctx.stopService(i);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Sazcord")
                .setContentText("Идёт звонок")
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ требует явно объявить тип сервиса при старте.
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIF_ID, n);
        }
        running = true;
        // START_NOT_STICKY: если систему всё же прибила нас, воскрешать
        // сервис без звонка бессмысленно — JS сам поднимет его заново.
        return START_NOT_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Звонки", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Держит соединение, пока идёт разговор");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
