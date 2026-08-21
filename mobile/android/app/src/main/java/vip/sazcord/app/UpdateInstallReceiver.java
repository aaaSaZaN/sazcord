package vip.sazcord.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Environment;
import android.widget.Toast;

import java.io.File;

/**
 * Результат установки обновления через PackageInstaller.
 *
 * Сессия коммитится асинхронно, поэтому платформа отвечает не возвратом
 * из commit(), а broadcast'ом сюда. Три исхода:
 *
 *   STATUS_PENDING_USER_ACTION — самый частый и самый важный. Платформа
 *     не ставит пакет молча: она кладёт в EXTRA_INTENT свой диалог
 *     подтверждения, и показать его должны мы. Если это проигнорировать,
 *     установка просто зависнет в сессии — ровно тот же симптом «ничего
 *     не происходит», от которого мы уходили.
 *
 *   STATUS_SUCCESS — процесс приложения будет убит и заменён новым.
 *     Показывать тут нечего.
 *
 *   любой STATUS_FAILURE_* — раньше причина терялась совсем. Теперь
 *     показываем текст от установщика: он различает «нет места»,
 *     «конфликт подписи», «версия старше установленной».
 */
public class UpdateInstallReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(
                PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = confirmIntent(intent);
            if (confirm == null) return;
            // Receiver'у нужен собственный таск: контекста activity у нас
            // здесь нет, а без флага startActivity кинет исключение.
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                context.startActivity(confirm);
            } catch (Exception e) {
                toast(context, "Не удалось открыть диалог установки");
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            // Установка прошла — скачанный APK больше не нужен. Сам он не
            // исчезнет: следующая проверка сверит его sha256 с новым
            // манифестом, не сойдётся и скачает заново, а этот так и
            // останется занимать место до тех пор.
            discardDownloadedApk(context);
            return;
        }

        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        toast(context, "Обновление не установлено: "
                + (msg == null || msg.isEmpty() ? describe(status) : msg));
    }

    private static void discardDownloadedApk(Context context) {
        try {
            File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) return;
            File apk = new File(dir, "sazcord-update.apk");
            if (apk.exists()) //noinspection ResultOfMethodCallIgnored
                apk.delete();
            context.getSharedPreferences("sazcord", Context.MODE_PRIVATE)
                    .edit().remove("pendingUpdateApk").apply();
        } catch (Exception ignored) {
            // Не критично: лишний файл переживём, ронять процесс из-за
            // уборки — нет.
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmIntent(Intent intent) {
        // Типизированная перегрузка getParcelableExtra появилась в API 33,
        // а minSdk у нас 24 — поэтому старый вариант с подавлением.
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    private static String describe(int status) {
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                return "установка отменена";
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return "заблокировано системой";
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                return "конфликт с установленной версией";
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return "несовместимо с устройством";
            case PackageInstaller.STATUS_FAILURE_INVALID:
                return "повреждённый пакет";
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return "не хватает места";
            default:
                return "неизвестная ошибка";
        }
    }

    private static void toast(Context context, String text) {
        Toast.makeText(context.getApplicationContext(), text, Toast.LENGTH_LONG).show();
    }
}
