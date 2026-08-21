import { useEffect } from 'react';
import { applyShortcuts, isDesktop } from '../utils/desktop';
import type { Shortcuts, ShortcutAction } from '../utils/desktop';

/**
 * useKeybinds — синхронизация настроек keybinds с десктоп-обёрткой.
 *
 * Поток событий (одинаковый для клавиатуры и мыши):
 *   1) При ИЗМЕНЕНИИ settings.keybinds renderer шлёт свежую карту в
 *      main-процесс (preload → ipcRenderer.invoke 'shortcuts:set').
 *   2) Main разделяет карту на клавиатурные acc'ы (→ Electron
 *      globalShortcut) и мышиные acc'ы (→ uiohook-napi mouseHook).
 *      Оба слоя — ОС-уровневые, работают даже когда окно Sazcord
 *      свёрнуто/не в фокусе.
 *   3) При срабатывании любого из них main шлёт IPC 'shortcut:fired'.
 *      preload превращает его в DOM-event 'sazcord:shortcut'. На него
 *      подписаны useCall и useGroupCall — они и не знают, был ли
 *      источник клавиатурным или мышиным.
 *
 * Раньше мышиные acc'ы обрабатывались тут, в renderer'е, через
 * window-level mousedown listener — но это работало только пока окно
 * Sazcord в фокусе, что бесполезно для PTT/мьюта во время игр и любых
 * fullscreen-приложений. С добавлением uiohook-napi мышь стала
 * глобальной, и весь mousedown-обработчик переехал в main (см.
 * desktop/mouseHook.js).
 *
 * На вебе (window.electronAPI отсутствует) хук — no-op. Поле
 * settings.keybinds всё равно сохраняется в localStorage, но UI вкладки
 * «Горячие клавиши» прячется (см. SettingsPanel.desktopOnly), так что
 * пустые значения в браузере незаметны.
 *
 * Поле deps — плоский набор значений keybinds. Если добавляешь новое
 * действие, не забудь:
 *   1) расширить ShortcutAction в utils/desktop.ts;
 *   2) добавить ключ в DEFAULTS.keybinds в SettingsContext;
 *   3) расширить deps ниже;
 *   4) добавить слушателя в useCall.ts/useGroupCall.ts.
 */
export function useKeybinds(keybinds: Partial<Record<ShortcutAction, string | null>> | undefined) {
  const toggleMute = keybinds?.toggleMute ?? null;
  const toggleDeafen = keybinds?.toggleDeafen ?? null;

  // Передаём ВСЮ карту, включая мышиные acc'ы — main сам разделит:
  // клавиатурные пойдут в Electron globalShortcut, мышиные — в uIOhook.
  // Никакой фильтрации тут не нужно.
  useEffect(() => {
    if (!isDesktop()) return;
    const map: Shortcuts = { toggleMute, toggleDeafen };
    void applyShortcuts(map);
  }, [toggleMute, toggleDeafen]);
}
