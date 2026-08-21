// Автообновление десктоп-клиента Sazcord.
//
// Поток:
//   1. Через 8 секунд после старта приложения и далее раз в 6 часов
//      опрашиваем feed (см. publish-конфиг в package.json).
//   2. electron-updater сам тащит latest.yml с сервера и сравнивает версии.
//   3. Если есть новее — качает diff (differentialPackages: true в NSIS-
//      конфиге) или полный installer в `%APPDATA%\Sazcord\__pending` в фоне.
//   4. Все события прокидываются в renderer через IPC 'update:event' →
//      preload превращает в DOM-event 'sazcord:update' для React-тоста.
//   5. Юзер жмёт «Перезапустить и обновить» → renderer вызывает
//      ipc 'update:install' → autoUpdater.quitAndInstall() → silent NSIS
//      replace + рестарт.
//
// Что НЕ делаем:
//   - Не запускаем апдейтер в dev-режиме (`electron .`) — там
//     app.isPackaged = false. electron-updater всё равно бы упал на отсутствии
//     `app-update.yml`, который пишется только при packaging.
//   - Не блокируем UI на проверку. Если сервер недоступен — тихо
//     логируем и пробуем в следующий раз.

const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const https = require('node:https');
const http = require('node:http');
const { shell } = require('electron');

// Каталог фида по платформе. Совпадает с раскладкой на сервере
// (server/src/index.js → app.use('/updates', …)):
//   /updates/windows | /updates/mac | /updates/linux | /updates/android
const FEED_DIR = { win32: 'windows', darwin: 'mac', linux: 'linux' };

// macOS: Squirrel.Mac (движок под electron-updater) ОТКАЗЫВАЕТСЯ ставить
// апдейт, если приложение не подписано Developer ID сертификатом Apple —
// он сверяет code signature старой и новой сборки. Ad-hoc подписи, которую
// ставит electron-builder без сертификата, недостаточно: обновление падает
// с «Could not get code signature for running application».
//
// Поэтому на маке идём другим путём: сами читаем latest-mac.yml, сравниваем
// версии и, если есть новее, предлагаем СКАЧАТЬ .dmg (открываем ссылку в
// браузере). Установка руками — перетащить в Applications. Как только у
// проекта появится Developer ID, достаточно выставить
// SAZCORD_MAC_AUTOUPDATE=1 и включится штатный полностью автоматический путь.
const MAC_MANUAL = process.platform === 'darwin' && process.env.SAZCORD_MAC_AUTOUPDATE !== '1';

function feedUrlFor(serverUrl) {
  const dir = FEED_DIR[process.platform];
  if (!serverUrl || !dir) return null;
  return `${String(serverUrl).replace(/\/+$/, '')}/updates/${dir}`;
}

// Мини-GET с редиректами. Отдельная функция вместо fetch, потому что нужен
// контроль таймаута и работа на старых Electron без глобального fetch.
function fetchText(url, { timeoutMs = 15000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchText(next, { timeoutMs, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code} для ${url}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('таймаут запроса обновления')));
    req.on('error', reject);
  });
}

// latest-mac.yml от electron-builder — плоский YAML. Тащить сюда парсер
// ради двух полей не хочется: вытаскиваем version и имя .dmg регуляркой.
function parseMacFeed(yml) {
  const version = (yml.match(/^version:\s*(.+)$/m) || [])[1];
  const dmg = (yml.match(/url:\s*(\S+\.dmg)/) || [])[1];
  const zip = (yml.match(/url:\s*(\S+\.zip)/) || [])[1];
  return {
    version: version ? version.trim() : null,
    file: (dmg || zip || '').trim() || null,
  };
}


// Файловый лог auto-update в %APPDATA%\Sazcord\logs\main.log (Windows),
// ~/Library/Logs/Sazcord/main.log (mac), ~/.config/Sazcord/logs/main.log
// (linux). Без этого у юзеров «слепое пятно»: NSIS-сборка не пишет
// stdout никуда (нет parent-консоли), и понять, почему «Проверяю…»
// висит — невозможно. Размер файла ограничиваем, чтобы не пухло.
log.transports.file.level = 'info';
log.transports.file.maxSize = 1024 * 1024; // 1 MB
log.transports.console.level = 'info';

// Нет авто-инсталла при quit'е — иначе юзер может неожиданно поймать
// рестарт при закрытии окна. Делаем явное действие через UI-кнопку.
autoUpdater.autoInstallOnAppQuit = false;
// Авто-скачивание оставляем включённым: пользователь увидит готовое
// обновление с минимальным ожиданием. Скачивание идёт в фоне и не
// блокирует UI; на медленном канале — viewing прогресс через тост.
autoUpdater.autoDownload = true;
// Все стадии auto-update идут в файл-лог. Поднять уровень логирования
// до 'debug' можно при необходимости (видно весь network-flow).
autoUpdater.logger = log;

// Интервал фоновой проверки. 1 час = достаточно шустро для юзера
// (увидит тост в течение часа после релиза, если окно открыто), и
// одновременно не спамит latest.yml с сотен клиентов. latest.yml весит
// ~350 байт + HTTP-оверхед, так что сеть не напрягается.
const ONE_HOUR = 60 * 60 * 1000;
const STARTUP_DELAY = 8000;

let setupDone = false;
let pollTimer = null;

// Кэш последнего значимого update-event'а. Используется, чтобы решить
// race condition: фоновая проверка может скачать installer ДО того, как
// renderer полностью загрузил веб-фронт и навесил listener на 'update:event'.
// В этом случае broadcast'нутый 'downloaded' event просто теряется, и в UI
// никогда не появляется кнопка «Перезапустить и обновить».
//
// С кэшем renderer на mount запрашивает текущее состояние через IPC
// 'update:get-state' и сразу подхватывает 'downloaded', если он уже был.
// Также при ручной проверке мы можем сразу переэмитить кэш, не запуская
// заново checkForUpdates() (который для уже-скачанного файла молчит).
let lastUpdateState = null;

function broadcast(window, kind, payload = {}) {
  const state = { kind, ...payload };
  // Сохраняем терминальные/значимые состояния. 'checking' и 'progress'
  // не кэшируем — они слишком быстро устаревают; кэш интересен для тех
  // случаев, когда renderer пропустил event и хочет узнать «что вообще
  // происходит с апдейтом прямо сейчас».
  if (kind === 'available' || kind === 'downloaded' || kind === 'error' || kind === 'none') {
    lastUpdateState = state;
  }
  if (!window || window.isDestroyed()) return;
  try {
    window.webContents.send('update:event', state);
  } catch {
    // окно могло закрыться между проверкой и send
  }
}

// Сравнение semver-версий "X.Y.Z". Возвращает true, если remote строго
// новее, чем local. Простая поэлементная разбивка по точкам — suffix'ов
// типа "-rc1" у нас в релизах нет, городить semver-пакет не нужно.
function isVersionNewer(remote, local) {
  const r = String(remote || '')
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  const l = String(local || '')
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] || 0;
    const b = l[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

// Обёртка над autoUpdater.checkForUpdates() с фиксом для случая, когда
// installer уже лежит в %LOCALAPPDATA%\@sazcorddesktop-updater\pending от
// прошлой сессии (например, пользователь скачал апдейт, но не нажал
// «Перезапустить и обновить», а потом перезагрузил машину).
//
// В таком кейсе electron-updater при checkForUpdates():
//   1) эмитит 'checking-for-update' и 'update-available' как обычно,
//   2) видит файл в pending, возвращает result с downloadPromise = null,
//   3) НЕ эмитит повторного 'update-downloaded' event'а.
//
// UI в SettingsPanel завязан на event'ы: после 'available' ждёт 'progress'
// или 'downloaded'. Не получая ничего, через 60 сек срабатывает watchdog
// и показывает «Нет ответа от сервера обновлений (60 сек)» — хотя файл
// УЖЕ готов к установке.
//
// Здесь мы вручную эмитим 'downloaded' broadcast, если updateInfo.version
// новее текущей и downloadPromise null.
async function safeCheckForUpdates(updater, window, app) {
  const result = await updater.checkForUpdates();
  if (!result || !result.updateInfo) return result;
  const remoteVer = result.updateInfo.version;
  const localVer = app.getVersion();
  if (!result.downloadPromise && isVersionNewer(remoteVer, localVer)) {
    broadcast(window, 'downloaded', {
      version: remoteVer,
      releaseDate: result.updateInfo.releaseDate,
    });
  }
  return result;
}

/**
 * Подключает autoUpdater к окну. Вызывать один раз после createWindow.
 * Безопасен к повторному вызову (idempotent).
 */
function setup(window, { app, ipcMain, serverUrl }) {
  if (setupDone) return;
  const feedUrl = feedUrlFor(serverUrl);
  // В dev электрон не упакован — пропускаем сам auto-update flow
  // (electron-updater разнесёт приложение, потому что app-update.yml
  // кладётся только в asar). НО IPC-стабы регистрируем — иначе renderer
  // ловит "No handler registered for 'update:check'" каждый раз, когда
  // ScreenQualityModal/SettingsPanel дёргают checkForUpdates() при mount.
  if (!app.isPackaged) {
    setupDone = true;
    ipcMain.handle('update:check', () => ({
      ok: false,
      error: 'Auto-update недоступен в dev-режиме',
    }));
    ipcMain.handle('update:install', () => false);
    ipcMain.handle('update:get-state', () => null);
    return;
  }

  // Сервер ещё не выбран (первый запуск, экран настройки) — обновляться
  // не от кого. Важно выйти ДО обращения к autoUpdater: без setFeedURL он
  // возьмёт фид из вшитого при сборке app-update.yml, то есть постучится
  // на чужой хост, который к этой инсталляции никакого отношения не имеет.
  // IPC-стабы всё равно регистрируем — их дёргает UI настроек.
  if (!feedUrl) {
    setupDone = true;
    ipcMain.handle('update:check', () => ({
      ok: false,
      error: 'Сначала укажи адрес сервера',
    }));
    ipcMain.handle('update:install', () => false);
    ipcMain.handle('update:get-state', () => null);
    return;
  }

  // --- macOS без Developer ID: ручной путь --------------------------------
  if (MAC_MANUAL) {
    setupDone = true;
    let latest = null; // { version, file }

    const checkManual = async () => {
      if (!feedUrl) {
        broadcast(window, 'error', { message: 'Адрес сервера обновлений не задан' });
        return;
      }
      broadcast(window, 'checking');
      try {
        const yml = await fetchText(`${feedUrl}/latest-mac.yml`);
        const parsed = parseMacFeed(yml);
        if (!parsed.version || !parsed.file) {
          broadcast(window, 'error', { message: 'Некорректный манифест обновления' });
          return;
        }
        latest = parsed;
        if (isVersionNewer(parsed.version, app.getVersion())) {
          // manual:true — UI покажет «Скачать», а не «Перезапустить».
          broadcast(window, 'downloaded', {
            version: parsed.version,
            manual: true,
            downloadUrl: `${feedUrl}/${parsed.file}`,
          });
        } else {
          broadcast(window, 'none');
        }
      } catch (e) {
        log.warn('mac manual update check failed:', e?.message || e);
        broadcast(window, 'error', { message: e?.message || String(e) });
      }
    };

    ipcMain.handle('update:check', () => {
      checkManual().catch(() => {
        /* уже отправили error-broadcast */
      });
      return { ok: true };
    });

    // «Установить» на маке = открыть .dmg в браузере. Дальше юзер сам
    // перетащит приложение в Applications — обойти это без подписи нельзя.
    ipcMain.handle('update:install', () => {
      if (!latest || !feedUrl) return false;
      shell.openExternal(`${feedUrl}/${latest.file}`).catch(() => {});
      return true;
    });

    ipcMain.handle('update:get-state', () => lastUpdateState);

    setTimeout(() => {
      checkManual().catch(() => {});
    }, STARTUP_DELAY);
    pollTimer = setInterval(() => {
      checkManual().catch(() => {});
    }, ONE_HOUR);
    return;
  }

  // Фид берём от текущего serverUrl, а не только из вшитого в сборку
  // app-update.yml: юзер может переключить адрес сервера в настройках,
  // и обновления должны поехать за ним, а не остаться на старом хосте.
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
      log.info('update feed:', feedUrl);
    } catch (e) {
      log.warn('setFeedURL failed, остаёмся на вшитом фиде:', e?.message || e);
    }
  }

  autoUpdater.on('checking-for-update', () => broadcast(window, 'checking'));

  autoUpdater.on('update-available', (info) => {
    broadcast(window, 'available', {
      version: info?.version,
      releaseDate: info?.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => broadcast(window, 'none'));

  autoUpdater.on('error', (err) => {
    broadcast(window, 'error', { message: err?.message || String(err) });
  });

  autoUpdater.on('download-progress', (p) => {
    broadcast(window, 'progress', {
      percent: p?.percent ?? 0,
      bytesPerSecond: p?.bytesPerSecond ?? 0,
      transferred: p?.transferred ?? 0,
      total: p?.total ?? 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcast(window, 'downloaded', {
      version: info?.version,
      releaseDate: info?.releaseDate,
    });
  });

  // IPC: рестарт с применением апдейта.
  // Параметры quitAndInstall:
  //   isSilent=true — installer NSIS работает без UI (юзер не видит мастер
  //     при обновлении, только сразу рестарт в новую версию).
  //   forceRunAfter=true — после установки сразу запустить обновлённое
  //     приложение, а не только закрыть текущее.
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(true, true);
    return true;
  });

  // IPC: ручная проверка по кнопке в настройках.
  //
  // НЕ ждём resolve самого checkForUpdates(): при autoDownload=true этот
  // promise висит ДО конца download'а полного installer'а (~100 MB), а
  // в редких кейсах (порвалась сеть, сервер не отвечает после headers)
  // не резолвится никогда. Раньше из-за этого UI «Проверяю…» висел до
  // победы — IPC просто не возвращал response.
  //
  // Сейчас стартуем проверку в фоне и сразу отдаём { ok: true }. Все
  // финальные стадии (available / progress / downloaded / none / error)
  // прилетают в renderer через broadcast 'update:event' — их и слушает
  // UI для перехода из 'checking' в терминальный стейт.
  ipcMain.handle('update:check', () => {
    // Если в кэше уже есть значимое состояние — переэмитим его и НЕ
    // запускаем повторный checkForUpdates(). Это закрывает сразу
    // несколько проблем:
    //
    //   - 'downloaded' в кэше: файл уже в pending, повторный
    //     checkForUpdates() для него ничего нового не эмитит, UI бы
    //     ждал вечно. Здесь сразу показываем кнопку «Перезапустить».
    //   - 'available' в кэше: фоновый poll УЖЕ запустил download,
    //     повторный checkForUpdates() возвращает тот же идущий
    //     downloadPromise без эмита новых event'ов. Здесь сразу
    //     показываем «скачивается», и UI получит штатный 'downloaded'
    //     event, когда download закончится.
    //   - 'error' в кэше: не пытаемся повторять сразу, отдаём прошлую
    //     ошибку. Юзер может попробовать позже, или фоновый часовой
    //     poll переоткроет ситуацию.
    if (
      lastUpdateState &&
      (lastUpdateState.kind === 'downloaded' ||
        lastUpdateState.kind === 'available' ||
        lastUpdateState.kind === 'error')
    ) {
      broadcast(window, lastUpdateState.kind, lastUpdateState);
      return { ok: true };
    }
    safeCheckForUpdates(autoUpdater, window, app).catch((e) => {
      log.warn('manual update:check failed:', e?.message || e);
    });
    return { ok: true };
  });

  // IPC: запрос текущего состояния auto-update. Renderer вызывает на
  // mount (UpdateToast/SettingsPanel), чтобы догнать пропущенные event'ы.
  // Возвращает либо последний кэшированный state, либо null если ничего
  // значимого не происходило в этой сессии.
  ipcMain.handle('update:get-state', () => lastUpdateState);

  // Стартовая проверка с небольшой задержкой — пусть UI прогрузится,
  // window-listener'ы навесятся, потом начинаем шуметь сетью.
  setTimeout(() => {
    safeCheckForUpdates(autoUpdater, window, app).catch(() => {
      /* свалимся в error-event */
    });
  }, STARTUP_DELAY);

  // Периодическая проверка. clearInterval не нужен — процесс завершится
  // вместе с окном; node таймеры не держат event loop при app.quit().
  pollTimer = setInterval(() => {
    safeCheckForUpdates(autoUpdater, window, app).catch(() => {
      /* swallow */
    });
  }, ONE_HOUR);

  setupDone = true;
}

function teardown() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Сбросить апдейтер, чтобы setup() можно было вызвать заново.
 *
 * Нужно при смене адреса сервера. setup() идемпотентен по setupDone и
 * читает serverUrl ровно один раз — без сброса инсталляция, стартовавшая
 * с пустым адресом (первый запуск), навсегда оставалась бы с заглушками
 * «Сначала укажи адрес сервера», даже после того как юзер сервер укажет.
 *
 * ipcMain.handle падает на повторной регистрации того же канала, поэтому
 * снимаем хендлеры явно, а не полагаемся на перезапись.
 */
function reset(ipcMain) {
  teardown();
  // Иначе на каждый повторный setup() навешивается ещё один комплект
  // 'checking-for-update'/'update-available'/…, и renderer получает
  // дубликаты одного события.
  try {
    autoUpdater.removeAllListeners();
  } catch {
    /* не критично */
  }
  for (const ch of ['update:check', 'update:install', 'update:get-state']) {
    try {
      ipcMain.removeHandler(ch);
    } catch {
      // хендлера могло не быть — не важно
    }
  }
  lastUpdateState = null;
  setupDone = false;
}

module.exports = { setup, teardown, reset };
