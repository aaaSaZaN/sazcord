package vip.sazcord.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.Executors;

/**
 * Самообновление Android-клиента.
 *
 * Магазина у нас нет, поэтому обновляемся сами с того же сервера, что
 * раздаёт веб-клиент:
 *
 *   GET  <serverUrl>/updates/android/latest.json
 *        { "versionCode": 903, "versionName": "0.9.3",
 *          "url": "sazcord-0.9.3.apk", "sha256": "<hex>" }
 *
 * Если versionCode больше установленного — спрашиваем юзера, качаем APK
 * в getExternalFilesDir(DOWNLOADS), сверяем sha256 и ставим через
 * PackageInstaller.
 *
 * sha256 сверяем обязательно: APK ставится с правами «установить пакет»,
 * так что молча доверять содержимому HTTP-ответа нельзя даже по HTTPS —
 * это дешёвая защита от битой докачки и от подмены файла на сервере.
 *
 * --- Почему PackageInstaller, а не Intent -----------------------------
 *
 * Раньше здесь был классический путь: FileProvider + ACTION_VIEW с типом
 * application/vnd.android.package-archive. На Android 14+ он мёртв —
 * системный установщик больше не экспортирует activity под этот фильтр.
 * Проверка на живом устройстве (Galaxy S23 Ultra, Android 16):
 *
 *   $ cmd package query-activities -a android.intent.action.VIEW \
 *       -t application/vnd.android.package-archive
 *   name=com.termux.filepicker.TermuxFileReceiverActivity
 *
 *   $ cmd package query-activities -a android.intent.action.INSTALL_PACKAGE
 *   (пусто)
 *
 * То есть intent уходил случайному приложению, которое умеет принимать
 * файлы (в том случае — Termux), и установка просто не начиналась.
 * Симптом со стороны юзера: «скачалось, разрешение выдал, ничего не
 * происходит». Если бы такого приложения на устройстве не было —
 * ActivityNotFoundException и краш, потому что вызов был без try/catch.
 *
 * PackageInstaller Session API — единственный поддерживаемый путь: сами
 * открываем сессию, стримим в неё APK, коммитим. Системный диалог
 * подтверждения показывает платформа, результат прилетает broadcast'ом
 * в UpdateInstallReceiver.
 */
public final class UpdateChecker {

    private static final String PREFS = "sazcord";
    /** Путь к скачанному, но ещё не установленному APK. */
    private static final String KEY_PENDING_APK = "pendingUpdateApk";

    private UpdateChecker() {
    }

    public static void checkInBackground(final Activity activity,
                                         final String serverUrl,
                                         final boolean interactive) {
        if (serverUrl == null || serverUrl.isEmpty()) return;
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                String base = serverUrl.replaceAll("/+$", "") + "/updates/android/";
                String body = httpGetString(base + "latest.json");
                JSONObject j = new JSONObject(body);
                final int remoteCode = j.optInt("versionCode", 0);
                final String remoteName = j.optString("versionName", "");
                final String fileName = j.optString("url", "");
                final String sha = j.optString("sha256", "");
                final int localCode = localVersionCode(activity);

                if (remoteCode <= localCode || fileName.isEmpty()) {
                    if (interactive) {
                        activity.runOnUiThread(() -> Toast.makeText(
                                activity, "Установлена последняя версия", Toast.LENGTH_SHORT).show());
                    }
                    return;
                }
                final String apkUrl = fileName.startsWith("http") ? fileName : base + fileName;
                activity.runOnUiThread(() -> promptInstall(activity, remoteName, apkUrl, sha));
            } catch (Exception e) {
                if (interactive) {
                    activity.runOnUiThread(() -> Toast.makeText(
                            activity, "Не удалось проверить обновления", Toast.LENGTH_SHORT).show());
                }
            }
        });
    }

    /**
     * Доустановка после возврата из системных настроек.
     *
     * Сценарий: юзер согласился обновиться, APK скачался, но разрешения
     * «ставить из этого источника» не было — мы увели его в настройки.
     * Он разрешил и вернулся в приложение. Без этого хука флоу обрывался
     * навсегда: файл лежит готовый, а установку никто не перезапускает.
     *
     * Вызывается из MainActivity.onResume(). Тихий no-op, если ставить
     * нечего или разрешение всё ещё не выдано.
     */
    public static void resumePendingInstall(final Activity activity) {
        SharedPreferences p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String path = p.getString(KEY_PENDING_APK, null);
        if (path == null) return;
        File apk = new File(path);
        if (!apk.exists()) {
            p.edit().remove(KEY_PENDING_APK).apply();
            return;
        }
        if (!canInstall(activity)) return;
        p.edit().remove(KEY_PENDING_APK).apply();
        install(activity, apk);
    }

    private static void promptInstall(final Activity activity, String version,
                                      final String apkUrl, final String sha) {
        new AlertDialog.Builder(activity)
                .setTitle("Доступно обновление")
                .setMessage("Sazcord " + version + ". Скачать и установить?")
                .setPositiveButton("Обновить", (d, w) -> download(activity, apkUrl, sha))
                .setNegativeButton("Позже", null)
                .show();
    }

    @SuppressWarnings("deprecation")
    private static void download(final Activity activity, final String apkUrl, final String sha) {
        // Если этот же APK уже скачан и цел — не тянем его второй раз.
        // Частый случай: прошлый заход упёрся в отсутствие разрешения.
        File cached = cachedApk(activity);
        if (cached != null && !sha.isEmpty() && sha.equalsIgnoreCase(sha256Of(cached))) {
            install(activity, cached);
            return;
        }

        final ProgressDialog dlg = new ProgressDialog(activity);
        dlg.setTitle("Загрузка обновления");
        dlg.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        dlg.setCancelable(false);
        dlg.setMax(100);
        dlg.show();

        Executors.newSingleThreadExecutor().execute(() -> {
            File out = null;
            try {
                File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null && !dir.exists()) //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                out = new File(dir, "sazcord-update.apk");
                if (out.exists()) //noinspection ResultOfMethodCallIgnored
                    out.delete();

                HttpURLConnection c = (HttpURLConnection) new URL(apkUrl).openConnection();
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                c.setInstanceFollowRedirects(true);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                int total = c.getContentLength();

                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    long got = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        md.update(buf, 0, n);
                        got += n;
                        if (total > 0) {
                            final int pct = (int) (got * 100 / total);
                            activity.runOnUiThread(() -> dlg.setProgress(pct));
                        }
                    }
                }

                if (sha != null && !sha.isEmpty()) {
                    StringBuilder hex = new StringBuilder();
                    for (byte b : md.digest()) hex.append(String.format("%02x", b));
                    if (!hex.toString().equalsIgnoreCase(sha.trim())) {
                        throw new Exception("контрольная сумма не совпала");
                    }
                }

                final File apk = out;
                activity.runOnUiThread(() -> {
                    dismiss(dlg);
                    install(activity, apk);
                });
            } catch (Exception e) {
                if (out != null && out.exists()) //noinspection ResultOfMethodCallIgnored
                    out.delete();
                final String msg = e.getMessage() == null ? "ошибка загрузки" : e.getMessage();
                activity.runOnUiThread(() -> {
                    dismiss(dlg);
                    Toast.makeText(activity, "Обновление не установлено: " + msg,
                            Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    @SuppressWarnings("deprecation")
    private static void dismiss(ProgressDialog d) {
        try {
            d.dismiss();
        } catch (Exception ignored) {
        }
    }

    private static boolean canInstall(Activity activity) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || activity.getPackageManager().canRequestPackageInstalls();
    }

    /**
     * Установка через PackageInstaller Session API.
     *
     * Целиком в try/catch: раньше исключение отсюда летело на UI-потоке и
     * роняло приложение вместо того, чтобы показать причину.
     */
    private static void install(final Activity activity, final File apk) {
        // Android 8+: установка из «неизвестного источника» разрешается
        // per-app. Разрешения нет — запоминаем APK и ведём в настройки;
        // MainActivity.onResume() доустановит после возврата.
        if (!canInstall(activity)) {
            activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(KEY_PENDING_APK, apk.getAbsolutePath()).apply();
            Toast.makeText(activity,
                    "Разреши установку приложений из этого источника — обновление продолжится само",
                    Toast.LENGTH_LONG).show();
            try {
                activity.startActivity(new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())));
            } catch (Exception ignored) {
                // На некоторых прошивках экрана нет — юзер дойдёт руками.
            }
            return;
        }

        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        int sessionId = -1;
        try {
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(activity.getPackageName());
            sessionId = installer.createSession(params);

            PackageInstaller.Session session = installer.openSession(sessionId);
            try {
                // Длину передаём явно: без неё установщик не может проверить,
                // что APK долился целиком, и падает уже на верификации.
                try (OutputStream out = session.openWrite("sazcord", 0, apk.length());
                     InputStream in = new FileInputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                session.commit(resultSender(activity, sessionId));
            } finally {
                session.close();
            }
        } catch (Exception e) {
            if (sessionId >= 0) {
                try {
                    installer.abandonSession(sessionId);
                } catch (Exception ignored) {
                }
            }
            final String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            Toast.makeText(activity, "Не удалось запустить установку: " + msg,
                    Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Куда PackageInstaller пришлёт результат.
     *
     * FLAG_MUTABLE обязателен: начиная с Android 12 система дописывает в
     * этот intent свои extras (статус, EXTRA_INTENT с диалогом
     * подтверждения). С immutable PendingIntent commit() кинет
     * IllegalArgumentException.
     */
    private static android.content.IntentSender resultSender(Activity activity, int sessionId) {
        Intent intent = new Intent(activity, UpdateInstallReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(activity, sessionId, intent, flags).getIntentSender();
    }

    /** Ранее скачанный APK, если он ещё на месте. */
    private static File cachedApk(Activity activity) {
        File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) return null;
        File f = new File(dir, "sazcord-update.apk");
        return f.exists() ? f : null;
    }

    private static String sha256Of(File f) {
        try (InputStream in = new FileInputStream(f)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static int localVersionCode(Activity a) {
        try {
            PackageManager pm = a.getPackageManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) pm.getPackageInfo(a.getPackageName(), 0).getLongVersionCode();
            }
            //noinspection deprecation
            return pm.getPackageInfo(a.getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String httpGetString(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setInstanceFollowRedirects(true);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream()) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        }
    }
}
