// Глобальный хук кнопок мыши через uiohook-napi.
//
// Зачем: Electron globalShortcut НЕ умеет ловить кнопки мыши на уровне
// ОС (его API принимает только клавиатурные acc'ы — см. shortcuts.js).
// Без нативного хука мышиные хоткеи (Mouse4/Mouse5/MouseMiddle) могут
// работать только пока окно Sazcord в фокусе, что бесполезно для
// PTT/мьюта во время игр и других fullscreen-приложений.
//
// uiohook-napi — N-API биндинги к libuiohook (кросс-платформенная
// C-библиотека), которая ставит ОС-уровневые input hooks (Win32
// SetWindowsHookEx, X11 XRecord, Quartz CGEventTap). Поставляется с
// prebuilt-binaries для win32/darwin/linux × x64/arm64, поэтому
// node-gyp/rebuild при сборке НЕ требуется.
//
// Контракт (зеркалит shortcuts.js):
//   register(map, win) — заменяет текущие мышиные bind'ы новой картой.
//     `map`  — { actionName: acceleratorString | null }; не-мышиные
//              acc'ы (без `MouseN`/`MouseMiddle` суффикса) тихо
//              пропускаются. Это позволяет вызывающей стороне отдавать
//              СЫРУЮ карту настроек, не разбирая её на «клавишные» и
//              «мышиные» ветки.
//     `win`  — BrowserWindow для отправки IPC 'shortcut:fired'. Тот же
//              канал, что использует shortcuts.js — renderer не должен
//              различать источник события.
//   unregisterAll() — снимает всё и останавливает фоновый поток uIOhook.
//
// Безопасность: модуль слушает ТОЛЬКО события мыши (`mousedown`).
// Клавиатурные события через uIOhook принципиально НЕ перехватываются —
// для клавиатуры используется штатный Electron globalShortcut, который
// не имеет доступа к содержимому нажатий вне зарегистрированных
// акселераторов. Так мы не выглядим как кейлоггер ни визуально (если
// кто-то посмотрит сорцы), ни поведенчески (на macOS Activity Monitor
// и т.п. показывает, что используется глобальный input hook).
//
// macOS: uIOhook.start() требует Accessibility permission. Если юзер
// не выдал — start() не падает, но события не приходят. Мы не
// заморачиваемся фолбэком (приложение пока Windows-only), но и не
// крашимся, чтобы при будущей поддержке macOS не нужно было
// переписывать lifecycle.

// Ленивый и защищённый require: uiohook-napi — нативный модуль, и на
// Linux он линкуется с libX11/libXtst. В AppImage/deb на «чистой» системе
// (или под Wayland без XWayland) require() кидает, и раньше это роняло
// ВЕСЬ main-процесс на старте — приложение не запускалось вообще. Мышиные
// хоткеи — фича необязательная, поэтому её отсутствие не должно мешать
// пользоваться мессенджером.
let uIOhook = null;
let uIOhookError = null;
function getHook() {
  if (uIOhook || uIOhookError) return uIOhook;
  try {
    uIOhook = require('uiohook-napi').uIOhook;
  } catch (e) {
    uIOhookError = e;
    console.warn('uiohook-napi unavailable, mouse hotkeys disabled:', e?.message || e);
  }
  return uIOhook;
}

// Парсинг и matching ВНУТРИ модуля, без зависимостей от utils/desktop.ts —
// тот живёт в renderer'е и не доступен в main-процессе. Логика 1-в-1
// совпадает с client/src/utils/desktop.ts:isMouseAccelerator и
// client/src/hooks/useKeybinds.ts:parseAccelerator (см. там, чтобы
// знать, где править если меняется набор кнопок).
const MOUSE_RE = /^Mouse(Middle|[3-9]|\d{2})$/;

function isMouse(acc) {
  if (!acc) return false;
  const last = acc.split('+').pop() || '';
  return MOUSE_RE.test(last);
}

function parseAcc(acc) {
  const parts = acc.split('+');
  const out = { ctrl: false, alt: false, shift: false, key: '' };
  for (const p of parts) {
    if (p === 'CommandOrControl' || p === 'Command' || p === 'Control') out.ctrl = true;
    else if (p === 'Alt') out.alt = true;
    else if (p === 'Shift') out.shift = true;
    else out.key = p;
  }
  return out;
}

// libuiohook button-коды (см. https://github.com/kwhat/libuiohook):
//   1 = MOUSE_BUTTON1 (ЛКМ)        — игнорим, иначе сломаем UI-клики
//   2 = MOUSE_BUTTON2 (ПКМ)        — то же
//   3 = MOUSE_BUTTON3 (Middle/СКМ) → 'MouseMiddle'
//   4 = MOUSE_BUTTON4 (X1 / Back)  → 'Mouse4'
//   5 = MOUSE_BUTTON5 (X2 / Fwd.)  → 'Mouse5'
function buttonToKey(btn) {
  if (btn === 3) return 'MouseMiddle';
  if (btn === 4) return 'Mouse4';
  if (btn === 5) return 'Mouse5';
  return null;
}

let binds = []; // [{ acc, action, parsed: { ctrl, alt, shift, key } }]
let win = null;
let hookStarted = false;
let listenerAttached = false;

function onMouseDown(e) {
  const key = buttonToKey(e.button);
  if (!key) return;
  for (const b of binds) {
    if (b.parsed.key !== key) continue;
    // Точное совпадение модификаторов — Ctrl+Mouse4 не должен срабатывать
    // на голый Mouse4 и наоборот (зеркалит useKeybinds.ts:matches).
    // CommandOrControl парсится в .ctrl=true; на macOS это означает Cmd
    // (e.metaKey), на Windows — настоящий Ctrl. Поэтому учитываем оба.
    const haveCtrl = !!(e.ctrlKey || e.metaKey);
    if (b.parsed.ctrl !== haveCtrl) continue;
    if (b.parsed.alt !== !!e.altKey) continue;
    if (b.parsed.shift !== !!e.shiftKey) continue;
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send('shortcut:fired', { action: b.action });
    } catch (err) {
      console.warn('mouseHook send failed:', err);
    }
    return;
  }
}

function start() {
  const hook = getHook();
  if (!hook) return;
  if (!listenerAttached) {
    hook.on('mousedown', onMouseDown);
    listenerAttached = true;
  }
  if (!hookStarted) {
    try {
      hook.start();
      hookStarted = true;
    } catch (e) {
      console.warn('uIOhook.start() failed:', e?.message || e);
    }
  }
}

function stop() {
  const hook = uIOhook;
  if (!hook) return;
  if (hookStarted) {
    try {
      hook.stop();
    } catch {
      /* */
    }
    hookStarted = false;
  }
  if (listenerAttached) {
    try {
      hook.removeListener('mousedown', onMouseDown);
    } catch {
      /* */
    }
    listenerAttached = false;
  }
}

function register(map, browserWindow) {
  win = browserWindow || null;
  binds = [];
  for (const [action, acc] of Object.entries(map || {})) {
    const v = (acc || '').trim();
    if (!isMouse(v)) continue;
    binds.push({ acc: v, action, parsed: parseAcc(v) });
  }
  // Если ни одного мышиного — выключаем фоновый поток, чтобы не
  // нагружать ОС зря (и не показываться в системных логах).
  if (binds.length === 0) {
    stop();
    return [];
  }
  start();
  return binds.map((b) => b.acc);
}

function unregisterAll() {
  binds = [];
  win = null;
  stop();
}

module.exports = { register, unregisterAll };
