// Preload для picker-окна.
//
// Exposes минимальный API, которого хватает HTML-странице для:
//   1) получить список источников (экранов/окон) с превью;
//   2) подтвердить выбор (id + флаг включения системного звука);
//   3) отменить (esc/крестик).
//
// Также прокидываем bootstrap-параметры (wantsAudio, platform), которые
// main передал через query string при loadFile().

const { contextBridge, ipcRenderer } = require('electron');

function readQuery() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return {
      wantsAudio: params.get('wantsAudio') === '1',
      platform: params.get('platform') || 'win32',
    };
  } catch {
    return { wantsAudio: false, platform: 'win32' };
  }
}

contextBridge.exposeInMainWorld('pickerAPI', {
  bootstrap: () => readQuery(),
  getSources: () => ipcRenderer.invoke('screen-picker:get-sources'),
  openSecuritySettings: () => ipcRenderer.invoke('screen-picker:open-security-settings'),
  getScreenStatus: () => ipcRenderer.invoke('screen-picker:get-screen-status'),
  select: (id, audio) => ipcRenderer.invoke('screen-picker:resolve', { id, audio }),
  cancel: () => ipcRenderer.invoke('screen-picker:cancel'),
});
