// Кастомный picker экранов/окон для desktop-стрима.
//
// Зачем:
//   В Electron 23+ navigator.mediaDevices.getDisplayMedia() в renderer'е
//   НИЧЕГО не покажет, пока в main-процессе не установлен
//   session.setDisplayMediaRequestHandler. Системного picker'а как в
//   Chromium-браузере у Electron нет (флаг useSystemPicker экспериментален
//   и работает не везде). Поэтому делаем свой — это и UX-плюс
//   (превьюшки в фирменной теме приложения), и фолбэк на любую ОС.
//
// Поток:
//   1. main вызывает pickScreenSource(parent, opts) → Promise.
//   2. Открываем модальное BrowserWindow (frameless, dark, parent=main).
//   3. picker-preload.js exposes window.pickerAPI:
//        - getSources() → desktopCapturer.getSources с превьюшками
//        - select(id, audio) → resolve промиса
//        - cancel() → resolve(null)
//   4. picker.html рендерит грид превью, юзер выбирает источник,
//      опционально включает «системный звук».
//   5. main получает { id, audio: boolean }, ищет source по id и отдаёт
//      его обратно в setDisplayMediaRequestHandler через callback.
//
// Особенности:
//   - Sources обновляем каждые 2 секунды на стороне renderer'а — это
//     дёшево (thumbnail 240x140) и сразу показывает только что открытые
//     окна (Discord так же).
//   - На Windows/Linux audio: 'loopback' даёт системный микшер. На macOS
//     OS не разрешает loopback из коробки, поэтому audio там пропускаем
//     (юзер увидит чекбокс disabled с подсказкой).
//   - Если parent уже закрыт к моменту резолва (юзер закрыл звонок) —
//     picker всё равно резолвится с null, ничего не падает.

const { BrowserWindow, desktopCapturer, ipcMain, shell, systemPreferences } = require('electron');
const path = require('path');

// Текущее состояние picker'а. Не singleton'им жёстко: если по какой-то
// причине предыдущий не успел закрыться (быстрый retry), просто
// переиспользуем — закрываем старый и открываем новый.
let activeWindow = null;
let activeResolver = null;
let handlersRegistered = false;

// Последний список источников, отданный picker'у (id -> DesktopCapturerSource).
//
// Зачем кэш: раньше setDisplayMediaRequestHandler после выбора юзера делал
// ВТОРОЙ desktopCapturer.getSources(), чтобы найти source по id. На Linux с
// Wayland/PipeWire (флаг WebRTCPipeWireCapturer) это ломает демонстрацию:
// каждый getSources() заново дёргает xdg-desktop-portal и выдаёт НОВЫЕ id,
// поэтому find() по старому id не находил ничего и хендлер отвечал
// callback({}) — «выбрал что стримить, а стрим не стартует». Берём объект
// из кэша, второй запрос к порталу не нужен.
let lastSources = new Map();

function getCachedSource(id) {
  return lastSources.get(id) || null;
}

function cleanup() {
  if (activeWindow && !activeWindow.isDestroyed()) {
    try {
      activeWindow.close();
    } catch {
      /* ignore */
    }
  }
  activeWindow = null;
  activeResolver = null;
}

function registerIpcHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Берём актуальный список источников с превьюшками. Размер картинки
  // подобран компромиссно: 240x140 даёт читабельную preview в гриде 3xN
  // и при этом захват самих превью занимает ~10-20мс на машину.
  ipcMain.handle('screen-picker:get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 240, height: 140 },
      // fetchWindowIcons даёт дополнительный иконку приложения для
      // window-источников; в гриде показываем её рядом с именем,
      // если есть.
      fetchWindowIcons: true,
    });
    lastSources = new Map(sources.map((s) => [s.id, s]));
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id || '',
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
    }));
  });

  ipcMain.handle('screen-picker:resolve', (_e, payload) => {
    const resolver = activeResolver;
    activeResolver = null;
    cleanup();
    if (resolver) {
      const id = payload?.id || null;
      // id формата `window:<HWND>:0` или `screen:<displayId>:0` —
      // парсим, чтобы main мог понять, какое аудио ему запускать
      // (per-process loopback для окна, system loopback для экрана).
      let kind = null;
      let hwnd = null;
      if (typeof id === 'string') {
        const colonIdx = id.indexOf(':');
        if (colonIdx > 0) {
          kind = id.slice(0, colonIdx);
          if (kind === 'window') {
            const rest = id.slice(colonIdx + 1);
            const nextColon = rest.indexOf(':');
            hwnd = nextColon > 0 ? rest.slice(0, nextColon) : rest;
          }
        }
      }
      resolver({
        id,
        kind,
        hwnd,
        name: getCachedSource(id)?.name || '',
        audio: !!payload?.audio,
      });
    }
    return true;
  });

  ipcMain.handle('screen-picker:cancel', () => {
    const resolver = activeResolver;
    activeResolver = null;
    cleanup();
    if (resolver) resolver(null);
    return true;
  });

  ipcMain.handle('screen-picker:open-security-settings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    return true;
  });

  ipcMain.handle('screen-picker:get-screen-status', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('screen');
    }
    return 'granted';
  });
}

/**
 * Открыть picker и дождаться выбора.
 * @param {Electron.BrowserWindow} parent
 * @param {{wantsAudio?: boolean, platform?: string}} [opts]
 * @returns {Promise<{id: string, audio: boolean} | null>}
 */
function pickScreenSource(parent, opts = {}) {
  registerIpcHandlers();

  // Если пред. picker завис открытым (теоретически не должно случаться) —
  // отрезолвим его как cancel и откроем свежий.
  if (activeResolver) {
    const old = activeResolver;
    activeResolver = null;
    old(null);
  }
  cleanup();

  return new Promise((resolve) => {
    activeResolver = resolve;

    activeWindow = new BrowserWindow({
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: !!parent && !parent.isDestroyed(),
      width: 760,
      height: 560,
      minWidth: 520,
      minHeight: 420,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#070a1a',
      title: 'Демонстрация экрана',
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    activeWindow.removeMenu();

    activeWindow.loadFile(path.join(__dirname, 'picker.html'), {
      // Прокидываем опции через query — picker-preload их прочитает и
      // отдаст в DOM. Это проще, чем городить отдельный IPC-хендлер
      // под bootstrap-параметры.
      query: {
        wantsAudio: opts.wantsAudio ? '1' : '0',
        platform: opts.platform || process.platform,
      },
    });

    activeWindow.once('ready-to-show', () => {
      if (!activeWindow || activeWindow.isDestroyed()) return;
      activeWindow.show();
      activeWindow.focus();
    });

    activeWindow.on('closed', () => {
      const resolver = activeResolver;
      activeResolver = null;
      activeWindow = null;
      // Закрытие крестиком/Esc приравниваем к Cancel.
      if (resolver) resolver(null);
    });
  });
}

module.exports = { pickScreenSource, getCachedSource };
