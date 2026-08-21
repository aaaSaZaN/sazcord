// Регистрация глобальных хоткеев в main-процессе. ТОЛЬКО клавиатурные —
// мышиные кнопки обрабатывает mouseHook.js (uiohook-napi), так как
// Electron globalShortcut по дизайну не принимает мышиные acc'ы.
//
// Контракт:
//   register(map, win) — снимает старые регистрации и ставит новые.
//     `map` — { actionName: acceleratorString | null }; null/'' = не регать.
//             Мышиные acc'ы (Mouse4/Mouse5/MouseMiddle/...) ТИХО
//             пропускаются — они придут сюда вместе с клавиатурными,
//             и нет смысла генерить шум в логах при попытке отдать их
//             в globalShortcut.register, который их всё равно отвергнет.
//     `win` — BrowserWindow, куда отправляем 'shortcut:fired' через webContents.send.
//   unregisterAll()    — снимает всё (вызываем при quit / blur'ом-выкл'е).
//
// Поведение:
//   - При нажатии хоткея main-процесс шлёт IPC 'shortcut:fired' с именем
//     action в renderer. Renderer (через preload) превращает в DOM-event
//     'sazcord:shortcut', на который подписаны useCall/useGroupCall.
//   - Если accelerator невалидный (Electron бросает) — логируем, но
//     приложение НЕ падает; остальные shortcut'ы регистрируются.
//   - Конфликт с другими приложениями: globalShortcut.register может
//     вернуть false — тогда мы это просто фиксируем в логах.

const { globalShortcut } = require('electron');

let registered = []; // массив accelerator'ов, которые мы реально повесили

// Дублирует логику mouseHook.js:isMouse — намеренно копируем сюда, чтобы
// shortcuts.js не зависел от mouseHook.js (порядок require'ов в main.js
// тогда становится критичным). Меняешь набор мышиных кнопок —
// синхронизируй в обоих файлах И в client/src/utils/desktop.ts.
const MOUSE_RE = /^Mouse(Middle|[3-9]|\d{2})$/;
function isMouseAcc(acc) {
  if (!acc) return false;
  const last = acc.split('+').pop() || '';
  return MOUSE_RE.test(last);
}

function unregisterAll() {
  for (const acc of registered) {
    try {
      globalShortcut.unregister(acc);
    } catch {
      /* */
    }
  }
  registered = [];
}

function register(map, win) {
  unregisterAll();
  for (const [action, accelerator] of Object.entries(map || {})) {
    const acc = (accelerator || '').trim();
    if (!acc) continue;
    // Мышиные acc'ы Electron globalShortcut не понимает — это территория
    // mouseHook.js. Тихо пропускаем, чтобы не плодить warnings.
    if (isMouseAcc(acc)) continue;
    try {
      const ok = globalShortcut.register(acc, () => {
        if (!win || win.isDestroyed()) return;
        try {
          win.webContents.send('shortcut:fired', { action });
        } catch (e) {
          console.warn('shortcut send failed:', e);
        }
      });
      if (ok) {
        registered.push(acc);
      } else {
        console.warn(`globalShortcut.register("${acc}") returned false (busy by another app?)`);
      }
    } catch (e) {
      console.warn(`globalShortcut.register("${acc}") threw:`, e?.message || e);
    }
  }
  return registered.slice();
}

module.exports = { register, unregisterAll };
