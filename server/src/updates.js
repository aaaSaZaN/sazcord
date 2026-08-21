// Раздача обновлений и манифест версий.
//
// Каталог с инсталляторами (по умолчанию <repo>/updates):
//
//   /updates/windows/  — latest.yml + «Sazcord Setup X.Y.Z.exe» (+ .blockmap)
//   /updates/mac/      — latest-mac.yml + Sazcord-X.Y.Z-arm64.zip / .dmg
//   /updates/linux/    — latest-linux.yml + Sazcord-X.Y.Z.AppImage
//   /updates/android/  — latest.json + sazcord-X.Y.Z.apk
//
// Десктоп ходит туда через electron-updater (generic provider), Android —
// через собственный чек latest.json. А GET /api/version отдаёт сводку по
// всем платформам сразу: она нужна веб-клиенту и PWA, у которых своего
// апдейтера нет вовсе, — им «обновление» означает «перезагрузи страницу,
// на сервере лежит новая сборка».

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UPDATES_DIR =
  process.env.UPDATES_DIR || path.resolve(__dirname, '..', '..', 'updates');

/** Версия самого сервера — она же версия веб-клиента, который он раздаёт. */
export const SERVER_VERSION = readOwnVersion();

function readOwnVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
    );
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Манифесты читаем с диска, но не на каждый запрос: клиенты опрашивают
// /api/version периодически, а файлы меняются только при деплое. Кэш
// инвалидируется по mtime каталога платформы — так подхват новой версии
// не требует рестарта сервера.
const cache = new Map(); // dir -> { mtimeMs, value }

function cached(dir, parse) {
  const full = path.join(UPDATES_DIR, dir);
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(full).mtimeMs;
  } catch {
    return null; // каталога нет — платформа просто не публикуется
  }
  const hit = cache.get(dir);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;
  let value = null;
  try {
    value = parse(full);
  } catch {
    value = null;
  }
  cache.set(dir, { mtimeMs, value });
  return value;
}

function androidManifest() {
  return cached('android', (full) => {
    const j = JSON.parse(fs.readFileSync(path.join(full, 'latest.json'), 'utf8'));
    if (!j || typeof j.versionName !== 'string') return null;
    return {
      version: j.versionName,
      versionCode: Number(j.versionCode) || 0,
      notes: typeof j.notes === 'string' ? j.notes : null,
      releaseDate: typeof j.releaseDate === 'string' ? j.releaseDate : null,
    };
  });
}

// latest*.yml от electron-builder — плоский YAML. Тащить сюда парсер ради
// одного поля не хочется: вытаскиваем version регуляркой, ровно как это
// делает desktop/autoUpdater.js для mac-фида.
function desktopManifest(dir, file) {
  return cached(dir, (full) => {
    const yml = fs.readFileSync(path.join(full, file), 'utf8');
    const version = (yml.match(/^version:\s*(.+)$/m) || [])[1];
    if (!version) return null;
    const releaseDate = (yml.match(/^releaseDate:\s*'?([^'\n]+)'?$/m) || [])[1];
    return {
      version: version.trim(),
      releaseDate: releaseDate ? releaseDate.trim() : null,
    };
  });
}

/**
 * Сводка доступных версий по платформам. Отсутствующая платформа —
 * null, а не ошибка: инстанс может публиковать только часть сборок
 * (например, вообще не собирать под linux).
 */
export function versionManifest() {
  return {
    server: SERVER_VERSION,
    platforms: {
      android: androidManifest(),
      windows: desktopManifest('windows', 'latest.yml'),
      mac: desktopManifest('mac', 'latest-mac.yml'),
      linux: desktopManifest('linux', 'latest-linux.yml'),
    },
  };
}
