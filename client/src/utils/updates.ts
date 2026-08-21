// Единый источник статуса обновления для всех трёх оболочек.
//
// До этого плашка и кнопка «Проверить обновления» жили только в Electron:
// весь UI был закрыт проверкой isDesktop(), потому что единственным
// источником событий был IPC от electron-updater. У APK свой нативный
// апдейтер (mobile/.../UpdateChecker.java), у веба и PWA не было ничего.
//
// Здесь три канала сведены к одному интерфейсу:
//
//   desktop — проксируем события electron-updater как есть. Умеет
//             скачивать в фоне и показывать прогресс, ставит по кнопке.
//   android — сравниваем versionName из GET /api/version с версией
//             нативной обёртки. Скачиванием и установкой занимается
//             сама обёртка, мы только дёргаем её и показываем плашку.
//   web     — сравниваем версию сборки (__APP_VERSION__, подставляется
//             Vite) с версией, которую раздаёт сервер. «Установить» =
//             перезагрузить страницу: Service Worker ничего не кеширует,
//             так что одной перезагрузки достаточно.

import {
  isDesktop,
  onUpdateEvent,
  getUpdateState,
  checkForUpdates as desktopCheck,
  installUpdate as desktopInstall,
  type UpdateEvent,
} from './desktop';
import { isAndroidShell, androidVersion, androidCheckUpdate } from './mobile';

export type UpdateChannel = 'desktop' | 'android' | 'web';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; version?: string; notes?: string | null }
  | {
      kind: 'progress';
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { kind: 'downloaded'; version?: string; manual?: boolean }
  | { kind: 'error'; message: string };

type VersionManifest = {
  server: string;
  platforms: {
    android: { version: string; versionCode: number; notes: string | null } | null;
    windows: { version: string } | null;
    mac: { version: string } | null;
    linux: { version: string } | null;
  };
};

/** Какой канал обновлений действует в текущей оболочке. */
export function updateChannel(): UpdateChannel {
  if (isDesktop()) return 'desktop';
  if (isAndroidShell()) return 'android';
  return 'web';
}

/**
 * Версия текущей сборки. В десктопе её отдаёт main-процесс отдельно
 * (getDesktopVersion), здесь — версия того, что выполняется прямо сейчас:
 * нативная обёртка на Android, веб-бандл в остальных случаях.
 */
export function currentVersion(): string | null {
  if (isAndroidShell()) return androidVersion();
  // В unit-тестах define из vite.config не применяется — не падаем.
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;
}

/**
 * Сравнение версий «X.Y.Z». Возвращает true, если remote строго новее.
 * Суффиксов вроде «-rc1» в релизах нет, поэтому тащить semver-пакет ради
 * этого не нужно — та же схема, что в desktop/autoUpdater.js.
 */
export function isNewer(remote?: string | null, local?: string | null): boolean {
  if (!remote || !local) return false;
  const r = remote.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const l = local.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] || 0;
    const b = l[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function fetchManifest(): Promise<VersionManifest | null> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VersionManifest;
  } catch {
    return null;
  }
}

/** Одна проверка для web/android. Для desktop см. subscribe/check ниже. */
async function pollOnce(): Promise<UpdateStatus> {
  const manifest = await fetchManifest();
  if (!manifest) return { kind: 'error', message: 'Сервер обновлений не ответил' };

  if (isAndroidShell()) {
    const remote = manifest.platforms.android;
    if (!remote) return { kind: 'none' };
    if (!isNewer(remote.version, currentVersion())) return { kind: 'none' };
    return { kind: 'available', version: remote.version, notes: remote.notes };
  }

  if (!isNewer(manifest.server, currentVersion())) return { kind: 'none' };
  return { kind: 'available', version: manifest.server };
}

// Как часто web/android сами ходят за манифестом. Полчаса — компромисс:
// после деплоя юзер увидит плашку в пределах получаса, при этом ответ
// весит пару сотен байт и на нагрузку не влияет. Плюс внеочередная
// проверка при возврате на вкладку — там обычно всё и ловится.
const POLL_MS = 30 * 60 * 1000;

/**
 * Подписка на статус обновления. Возвращает функцию отписки.
 *
 * Десктоп получает события пуш-стилем от main-процесса, web и android
 * опрашивают сервер. Наружу разница не торчит — оба зовут onStatus.
 */
export function subscribeUpdates(onStatus: (s: UpdateStatus) => void): () => void {
  if (isDesktop()) {
    let cancelled = false;
    void getUpdateState().then((cached) => {
      if (cancelled || !cached) return;
      onStatus(fromDesktopEvent(cached));
    });
    const off = onUpdateEvent((ev) => onStatus(fromDesktopEvent(ev)));
    return () => {
      cancelled = true;
      off();
    };
  }

  let stopped = false;
  const tick = () => {
    if (stopped) return;
    void pollOnce().then((s) => {
      // Молчим про ошибки фоновой проверки: сеть моргнула — не повод
      // показывать пользователю плашку. Ручная проверка (check) свою
      // ошибку покажет, там юзер её ждёт.
      if (!stopped && s.kind !== 'error') onStatus(s);
    });
  };

  tick();
  const timer = window.setInterval(tick, POLL_MS);
  const onFocus = () => tick();
  window.addEventListener('focus', onFocus);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('focus', onFocus);
  };
}

function fromDesktopEvent(ev: UpdateEvent | null): UpdateStatus {
  if (!ev) return { kind: 'idle' };
  if (ev.kind === 'available') return { kind: 'available', version: ev.version };
  if (ev.kind === 'downloaded') {
    return { kind: 'downloaded', version: ev.version, manual: ev.manual };
  }
  return ev;
}

/** Ручная проверка «прямо сейчас» — кнопка в настройках. */
export async function checkNow(): Promise<UpdateStatus> {
  if (isDesktop()) {
    const res = await desktopCheck();
    if (!res) return { kind: 'error', message: 'Апдейтер недоступен' };
    if (!res.ok) return { kind: 'error', message: res.error || 'Не удалось проверить' };
    // Терминальный статус прилетит через subscribeUpdates.
    return { kind: 'checking' };
  }
  if (isAndroidShell()) {
    // Нативная обёртка сама покажет диалог и тост «установлена последняя
    // версия», поэтому свой статус здесь не выдумываем.
    androidCheckUpdate();
    return { kind: 'checking' };
  }
  return pollOnce();
}

/**
 * Применить обновление. Что именно это значит — зависит от канала:
 * десктоп перезапускается в новую версию, Android отдаёт APK системному
 * установщику, веб просто перезагружает страницу.
 */
export async function applyUpdate(): Promise<void> {
  const channel = updateChannel();
  if (channel === 'desktop') {
    await desktopInstall();
    return;
  }
  if (channel === 'android') {
    androidCheckUpdate();
    return;
  }
  window.location.reload();
}
