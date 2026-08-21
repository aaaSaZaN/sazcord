package vip.sazcord.app;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Sazcord Android — тонкая обёртка над тем же самым веб-клиентом, который
 * открывается в браузере и в десктопной сборке. Никакой своей бизнес-логики:
 * WebView грузит https://<serverUrl>, всё остальное (чат, звонки, настройки)
 * живёт на сервере. Ровно та же модель, что и в desktop/main.js.
 *
 * Что обёртка добавляет поверх голого WebView:
 *   1. Права на микрофон/камеру — и системные (runtime permissions), и
 *      внутри-WebView'шные (onPermissionRequest). Без ВТОРОГО пункта
 *      getUserMedia() отдаёт NotAllowedError, даже когда системное
 *      разрешение выдано, — это самая частая причина «звонки не работают
 *      в WebView».
 *   2. Foreground-сервис на время звонка (см. CallService): иначе Android
 *      замораживает процесс после сворачивания и разговор обрывается.
 *   3. Самообновление (см. UpdateChecker).
 *   4. Экран ошибки со сменой адреса сервера, если хост недоступен.
 */
public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "sazcord";
    private static final String KEY_SERVER = "serverUrl";
    private static final int REQ_PERMS = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    /**
     * Показан ли сейчас локальный экран настройки сервера.
     *
     * Нужен как гейт для Bridge.saveServer(): мост через
     * addJavascriptInterface доступен ЛЮБОЙ загруженной странице, включая
     * страницы сервера. Молча переписывать адрес сервера по вызову из
     * веб-содержимого нельзя — иначе скомпрометированный (или просто
     * чужой) инстанс сможет увести клиент на себя. С нашего локального
     * HTML — можно, там источник ввода сам пользователь.
     */
    private boolean inSetup = false;
    private final androidx.activity.result.ActivityResultLauncher<Intent> fileChooser =
            registerForActivityResult(
                    new androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
                    result -> {
                        if (filePathCallback == null) return;
                        Uri[] uris = null;
                        Intent data = result.getData();
                        if (result.getResultCode() == RESULT_OK && data != null) {
                            if (data.getClipData() != null) {
                                int n = data.getClipData().getItemCount();
                                uris = new Uri[n];
                                for (int i = 0; i < n; i++) {
                                    uris[i] = data.getClipData().getItemAt(i).getUri();
                                }
                            } else if (data.getData() != null) {
                                uris = new Uri[]{data.getData()};
                            }
                        }
                        filePathCallback.onReceiveValue(uris);
                        filePathCallback = null;
                    });

    /**
     * Адрес сервера, либо null — если владелец инстанса его ещё не назвал.
     *
     * Дефолта здесь намеренно нет. Сборка одна на всех, а сервер у каждого
     * свой: единственный источник адреса — то, что юзер ввёл на экране
     * первичной настройки или сменил позже.
     */
    private String serverUrl() {
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stored = p.getString(KEY_SERVER, null);
        if (stored == null || stored.trim().isEmpty()) return null;
        String url = stored.trim();
        // Без схемы WebView уйдёт искать в поиске — нормализуем.
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    /** Грузим сервер, а если он ещё не задан — экран первичной настройки. */
    private void loadServerOrSetup() {
        String url = serverUrl();
        if (url == null) {
            showSetupPage(null);
        } else {
            inSetup = false;
            webView.loadUrl(url);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(0xFF0B0D10);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(0xFF0B0D10);
        root.addView(webView);
        setContentView(root);

        configureWebView();
        requestRuntimePermissions();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            loadServerOrSetup();
        }

        // Проверку обновлений делаем с задержкой — пусть сначала прогрузится UI.
        webView.postDelayed(() -> UpdateChecker.checkInBackground(this, serverUrl(), false), 6000);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Юзер мог уйти в системные настройки выдавать разрешение «ставить
        // из этого источника». Вернулся — доводим установку до конца, если
        // APK уже скачан. Без этого хука флоу обрывался навсегда.
        UpdateChecker.resumePendingInstall(this);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        // localStorage — там живёт сессия (sazcord.auth) и настройки.
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // КРИТИЧНО для звонков: без этого WebView требует «жест пользователя»
        // на каждый <audio>.play(), и входящий звук пира не воспроизводится.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Явный UA-суффикс: сервер и клиент могут отличить андроид-обёртку
        // от обычного мобильного браузера.
        s.setUserAgentString(s.getUserAgentString() + " SazcordAndroid/" + BuildConfig.VERSION_NAME);

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        webView.addJavascriptInterface(new Bridge(), "SazcordAndroid");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Пропускаем ТОЛЬКО медиа-ресурсы и только если системное
                // разрешение уже выдано — иначе WebView считает, что доступ
                // есть, а Android его режет, и трек уходит немым.
                runOnUiThread(() -> {
                    List<String> granted = new ArrayList<>();
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                                && hasPermission(Manifest.permission.RECORD_AUDIO)) {
                            granted.add(res);
                        } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                                && hasPermission(Manifest.permission.CAMERA)) {
                            granted.add(res);
                        }
                    }
                    if (granted.isEmpty()) {
                        request.deny();
                        requestRuntimePermissions();
                    } else {
                        request.grant(granted.toArray(new String[0]));
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    fileChooser.launch(params.createIntent());
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                String current = serverUrl();
                String host = current == null ? null : Uri.parse(current).getHost();
                // Свой хост открываем внутри, всё остальное (внешние ссылки
                // из сообщений) — в системном браузере.
                if (host != null && host.equalsIgnoreCase(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req == null || !req.isForMainFrame()) return;
                // На экране настройки сервера грузить нечего — там локальный
                // HTML, и «ошибка» может прилететь только от фонового мусора.
                if (serverUrl() == null) return;
                showErrorPage(err != null ? String.valueOf(err.getDescription()) : "нет соединения");
            }
        });
    }

    private void showErrorPage(String reason) {
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<style>body{background:#070a1a;color:#e2e8f0;font:15px -apple-system,Roboto,sans-serif;"
                + "display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}"
                + "div{padding:24px;max-width:340px}h1{font-size:17px;margin:0 0 8px}"
                + "p{color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 18px}"
                + "button{background:#5566ff;color:#fff;border:0;border-radius:8px;padding:10px 18px;"
                + "font-size:14px;margin:4px}button.s{background:#1e293b}</style>"
                + "<div><h1>Сервер недоступен</h1><p>" + escape(serverUrl()) + "<br>" + escape(reason) + "</p>"
                + "<button onclick=\"SazcordAndroid.reload()\">Повторить</button>"
                + "<button class=s onclick=\"SazcordAndroid.promptServer()\">Сменить адрес</button></div>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /**
     * Экран первичной настройки: приложение не знает ни одного сервера и
     * спрашивает адрес у владельца инстанса.
     *
     * Раньше вместо этого экрана в сборку был вшит адрес личного сервера
     * автора (BuildConfig.DEFAULT_SERVER_URL) — все чужие инсталляции
     * стучались туда, пока юзер не догадается сменить адрес на экране
     * ошибки. Теперь дефолта нет вообще.
     */
    private void showSetupPage(String error) {
        inSetup = true;
        String errBlock = (error == null || error.isEmpty())
                ? ""
                : "<p class=e>" + escape(error) + "</p>";
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<style>body{background:#070a1a;color:#e2e8f0;font:15px -apple-system,Roboto,sans-serif;"
                + "display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}"
                + "div{padding:24px;max-width:340px;width:100%;box-sizing:border-box}h1{font-size:17px;margin:0 0 8px}"
                + "p{color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 18px}"
                + "p.e{color:#f87171}"
                + "input{width:100%;box-sizing:border-box;padding:11px 12px;background:#111418;"
                + "border:1px solid #262e58;border-radius:8px;color:#e2e8f0;font-size:14px;margin-bottom:12px}"
                + "button{background:#5566ff;color:#fff;border:0;border-radius:8px;padding:11px 18px;"
                + "font-size:14px;width:100%}</style>"
                + "<div><h1>Подключение к серверу</h1>"
                + "<p>Введи адрес сервера Sazcord. Его даёт владелец сервера.</p>"
                + errBlock
                + "<input id=u inputmode=url autocapitalize=off autocorrect=off "
                + "placeholder='https://example.com:11000'>"
                + "<button onclick=\"SazcordAndroid.saveServer(document.getElementById('u').value)\">"
                + "Подключиться</button></div>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private boolean hasPermission(String p) {
        return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestRuntimePermissions() {
        List<String> need = new ArrayList<>();
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
        if (!hasPermission(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && !hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!need.isEmpty()) {
            ActivityCompat.requestPermissions(this, need.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        // Ничего не перезагружаем: веб-клиент сам повторит getUserMedia,
        // когда пользователь снова нажмёт «позвонить».
    }

    private void promptServerDialog() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        String current = serverUrl();
        input.setText(current == null ? "" : current);
        new AlertDialog.Builder(this)
                .setTitle("Адрес сервера Sazcord")
                .setView(input)
                .setPositiveButton("Сохранить", (d, w) -> {
                    String v = input.getText().toString().trim();
                    storeServer(v);
                    loadServerOrSetup();
                })
                .setNegativeButton("Отмена", null)
                .show();
    }

    private void storeServer(String url) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_SERVER, url == null ? "" : url.trim()).apply();
    }

    /**
     * Выход с сервера: забываем адрес и возвращаемся на экран настройки.
     *
     * Сессию (JWT в localStorage) чистим тоже — иначе при возврате на тот
     * же сервер юзер молча окажется залогинен под прошлым аккаунтом, хотя
     * визуально «вышел».
     */
    private void leaveServerAndReset() {
        webView.clearCache(false);
        android.webkit.WebStorage.getInstance().deleteAllData();
        storeServer("");
        showSetupPage(null);
    }

    /** Мост в JS. Доступен веб-клиенту как window.SazcordAndroid. */
    private class Bridge {
        @JavascriptInterface
        public void reload() {
            runOnUiThread(MainActivity.this::loadServerOrSetup);
        }

        @JavascriptInterface
        public void promptServer() {
            runOnUiThread(MainActivity.this::promptServerDialog);
        }

        /**
         * Сохранить адрес сервера. Принимается ТОЛЬКО с локального экрана
         * настройки (см. поле inSetup) — со страниц сервера вызов
         * игнорируется, чтобы веб-содержимое не могло переселить клиент на
         * чужой хост без ведома юзера. Странице сервера доступен
         * promptServer(), который спрашивает подтверждение у человека.
         */
        @JavascriptInterface
        public void saveServer(String url) {
            if (!inSetup) return;
            final String v = url == null ? "" : url.trim();
            runOnUiThread(() -> {
                if (v.isEmpty()) {
                    showSetupPage("Введи адрес сервера");
                    return;
                }
                storeServer(v);
                loadServerOrSetup();
            });
        }

        /** «Выйти с сервера» из настроек веб-клиента. */
        @JavascriptInterface
        public void leaveServer() {
            runOnUiThread(MainActivity.this::leaveServerAndReset);
        }

        @JavascriptInterface
        public String getVersion() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public boolean isDesktopShell() {
            return true;
        }

        /**
         * Веб-клиент сообщает, идёт ли сейчас звонок. На время звонка
         * поднимаем foreground-сервис, иначе система усыпит процесс через
         * пару минут после сворачивания и разговор оборвётся.
         */
        @JavascriptInterface
        public void setCallActive(boolean active) {
            runOnUiThread(() -> CallService.setActive(MainActivity.this, active));
        }

        /** Ручная проверка обновлений (кнопка в настройках клиента). */
        @JavascriptInterface
        public void checkUpdate() {
            runOnUiThread(() -> UpdateChecker.checkInBackground(MainActivity.this, serverUrl(), true));
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        if (webView != null) webView.saveState(out);
    }

    @Override
    protected void onDestroy() {
        CallService.setActive(this, false);
        if (webView != null) {
            webView.setWebChromeClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
