// Конфиг десктоп-приложения. Хранится в userData/sazcord.config.json:
//   - serverUrl     — куда грузим клиент (http://host:port или https://...)
//   - autoStart     — стартовать ли вместе с ОС (заходит в логин-айтемы).
//   - hotkeysEnabled — мастер-выключатель глобальных хоткеев.
//   - closeToTray   — крестик прячет окно в трей вместо закрытия (Discord-like).
//
// Зачем не localStorage клиента: serverUrl нужен ДО того, как мы загрузили
// клиент (иначе непонятно куда грузить), и хоткеи регистрируются в main-
// процессе, у которого нет доступа к renderer'овскому localStorage.
//
// Файл создаётся при первом запуске. Если parse падает — берём дефолты;
// записываем атомарно (write-rename), чтобы не получить полусохранённый
// JSON при крэше.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  // Дефолтного сервера НЕТ намеренно: сборка одна на всех, а инстанс у
  // каждого свой. Пустая строка — сигнал main-процессу показать экран
  // первичной настройки (см. loadServerUrl/setupHtml в main.js), где
  // адрес спрашивают у пользователя. Значение ляжет в этот файл и
  // переживёт обновление; сменить или выйти можно из настроек клиента.
  //
  // Для локальной разработки удобно переопределить через env:
  // `SAZCORD_SERVER_URL=http://localhost:5173 npm run desktop`.
  serverUrl: process.env.SAZCORD_SERVER_URL || '',
  autoStart: false,
  hotkeysEnabled: true,
  // По дефолту true: при закрытии окна приложение прячется в трей и
  // продолжает работать (звонки/уведомления). Юзер может отключить в
  // настройках, тогда крестик будет реально закрывать приложение.
  closeToTray: true,
  // Сериализованные биндинги. Главное — main-процесс перерегистрирует
  // shortcut'ы при изменении этого поля. Renderer заполняет его через
  // electronAPI.setShortcuts.
  shortcuts: {
    // 'toggleMute' | 'toggleDeafen' — accelerator-строка Electron'а
    // (https://electronjs.org/docs/latest/api/accelerator) или null.
    toggleMute: null,
    toggleDeafen: null,
  },
};

function configPath() {
  return path.join(app.getPath('userData'), 'sazcord.config.json');
}


function load() {
  let merged;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    merged = {
      ...DEFAULTS,
      ...parsed,
      shortcuts: { ...DEFAULTS.shortcuts, ...(parsed?.shortcuts || {}) },
    };
  } catch {
    merged = { ...DEFAULTS, shortcuts: { ...DEFAULTS.shortcuts } };
  }
  // В dev-режиме env SAZCORD_SERVER_URL ВСЕГДА бьёт сохранённый URL.
  // Это нужно, чтобы `npm run desktop:dev` смотрел на локальный сервер
  // независимо от того, остался ли в dev-профиле прежний URL прод-сервера.
  // В prod (app.isPackaged) env обычно не задана, и ничего не меняется.
  if (!app.isPackaged && process.env.SAZCORD_SERVER_URL) {
    merged.serverUrl = process.env.SAZCORD_SERVER_URL;
  }
  return merged;
}

function save(cfg) {
  const file = configPath();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    // rename atomically — иначе при крэше получим полупустой JSON.
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

module.exports = { load, save, DEFAULTS, configPath };
