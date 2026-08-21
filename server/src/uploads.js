import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(__dirname, '..', 'uploads');

// --- Magic-bytes sniffing ---------------------------------------------------
//
// Клиент в multipart легко подделывает Content-Type и расширение. Если мы
// доверяем заголовку — атакующий грузит файл с mime `image/jpeg`, но именем
// `evil.html`, и мы сохраняем его как .html. Дальше express.static отдаёт
// этот файл с `text/html` (по расширению) и браузер исполняет — XSS.
//
// Решение: после загрузки читаем первые байты с диска, определяем реальный
// тип, и:
//   - для аватаров/voice — строго проверяем, что magic совпадает с группой
//     image/* или audio/* соответственно;
//   - для всех загрузок — переписываем расширение по фактическому типу,
//     чтобы express.static никогда не отдавал text/html на основании имени.
//
// Поддерживаем популярные форматы, для которых WebRTC/мессенджер реально
// отдаёт данные: jpeg/png/gif/webp, webm/ogg/mp4/m4a/wav/mp3, pdf, zip,
// и плоский «бинарь» (.bin) для всего остального.
const MAGIC = [
  { ext: '.jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: '.png',
    mime: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { ext: '.gif', mime: 'image/gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    ext: '.webp',
    mime: 'image/webp',
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  { ext: '.bmp', mime: 'image/bmp', test: (b) => b[0] === 0x42 && b[1] === 0x4d },
  // EBML container — webm и обычный mkv. Различить можно по DocType, но
  // для нас оба разрешены как видео/аудио.
  {
    ext: '.webm',
    mime: 'video/webm',
    test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  {
    ext: '.ogg',
    mime: 'audio/ogg',
    test: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53,
  },
  {
    ext: '.wav',
    mime: 'audio/wav',
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x41 &&
      b[10] === 0x56 &&
      b[11] === 0x45,
  },
  {
    ext: '.flac',
    mime: 'audio/flac',
    test: (b) => b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43,
  },
  // mp3: либо ID3 в начале, либо frame-sync 0xFFEx.
  {
    ext: '.mp3',
    mime: 'audio/mpeg',
    test: (b) =>
      (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  },
  // ISO BMFF (mp4/m4a/mov) — на 4..7 байтах "ftyp".
  {
    ext: '.mp4',
    mime: 'video/mp4',
    test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  },
  {
    ext: '.pdf',
    mime: 'application/pdf',
    test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
  // ZIP-семейство (включая docx/xlsx/odf/jar) — оба общеупотребимых signature.
  {
    ext: '.zip',
    mime: 'application/zip',
    test: (b) =>
      b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
  {
    ext: '.7z',
    mime: 'application/x-7z-compressed',
    test: (b) =>
      b[0] === 0x37 &&
      b[1] === 0x7a &&
      b[2] === 0xbc &&
      b[3] === 0xaf &&
      b[4] === 0x27 &&
      b[5] === 0x1c,
  },
  {
    ext: '.rar',
    mime: 'application/vnd.rar',
    test: (b) => b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21,
  },
  { ext: '.gz', mime: 'application/gzip', test: (b) => b[0] === 0x1f && b[1] === 0x8b },
];

function sniffFile(absPath) {
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    if (n <= 0) return null;
    for (const m of MAGIC) {
      try {
        if (m.test(buf)) return m;
      } catch {
        /* slice past EOF — пропускаем */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd != null)
      try {
        fs.closeSync(fd);
      } catch {
        /* */
      }
  }
}

// Переименовать загруженный файл с правильным расширением по факту magic.
// Возвращает объект с обновлённым `path`/`mimetype`/`originalname` или
// бросает, если sniff провалился, а валидатор требовал группу.
//
// requireGroup: 'image' | 'audio' | null — если задан, magic должен быть
// в нужной группе, иначе кидаем ошибку (multer поймает и вернёт 400).
export function normalizeUpload(file, requireGroup = null) {
  if (!file || !file.path) return file;
  let sniff = sniffFile(file.path);
  if (requireGroup === 'image') {
    if (!sniff || !sniff.mime.startsWith('image/')) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* */
      }
      const e = new Error('expected image file');
      e.status = 400;
      throw e;
    }
  }
  if (requireGroup === 'audio') {
    // На voice-сообщениях разрешаем audio/* и webm-видео-контейнер
    // (браузеры пишут MediaRecorder в video/webm, даже если кодек только
    // звуковой — реальный mime из заголовка может быть «audio/webm» или
    // «video/webm», обе ветки принимаем).
    // Safari/iOS пишет MediaRecorder в ISO BMFF ('audio/mp4'), а magic у
    // него общий с видео — 'ftyp'. Такой файл валиден как голосовое, поэтому
    // 'video/mp4' здесь тоже принимаем и ниже переклеиваем на audio/mp4 + .m4a.
    const ok =
      sniff &&
      (sniff.mime.startsWith('audio/') ||
        sniff.mime === 'video/webm' ||
        sniff.mime === 'video/mp4' ||
        sniff.mime === 'application/ogg');
    if (!ok) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* */
      }
      const e = new Error('expected audio file');
      e.status = 400;
      throw e;
    }
  }
  // Для голосовых нормализуем контейнеры, у которых magic совпадает с
  // видео-вариантом: расширение и mime должны быть аудийными, иначе
  // express.static отдаст video/mp4 и <audio> в части браузеров не играет.
  if (requireGroup === 'audio' && sniff && sniff.mime === 'video/mp4') {
    sniff = { ...sniff, ext: '.m4a', mime: 'audio/mp4' };
  }

  // Если magic известен — переписываем расширение строго по нему.
  // Это закрывает кейс «evil.html с image/jpeg в Content-Type».
  if (sniff) {
    const dir = path.dirname(file.path);
    const base = path.basename(file.path, path.extname(file.path));
    const newAbs = path.join(dir, `${base}${sniff.ext}`);
    if (newAbs !== file.path) {
      try {
        fs.renameSync(file.path, newAbs);
        file.path = newAbs;
        file.filename = path.basename(newAbs);
      } catch {
        /* fail-soft */
      }
    }
    file.mimetype = sniff.mime;
  } else {
    // Тип неизвестен — на всякий случай переводим в .bin, чтобы
    // express.static не отдавал text/html, application/javascript и
    // прочие потенциально исполняемые типы по расширению из имени.
    const dir = path.dirname(file.path);
    const base = path.basename(file.path, path.extname(file.path));
    const newAbs = path.join(dir, `${base}.bin`);
    if (newAbs !== file.path) {
      try {
        fs.renameSync(file.path, newAbs);
        file.path = newAbs;
        file.filename = path.basename(newAbs);
      } catch {
        /* */
      }
    }
    file.mimetype = 'application/octet-stream';
  }
  return file;
}

const avatarsDir = path.join(UPLOADS_DIR, 'avatars');
const voiceDir = path.join(UPLOADS_DIR, 'voice');
const filesDir = path.join(UPLOADS_DIR, 'files');

for (const d of [UPLOADS_DIR, avatarsDir, voiceDir, filesDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function extFromMime(mime) {
  if (!mime) return '';
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('mpeg')) return '.mp3';
  return '';
}

// multer по RFC 7578 интерпретирует имя как latin1.
// Любые UTF-8 байты в `originalname` прилетают сюда побайтово как latin1,
// поэтому кириллица превращается в "Ð¾Ð±Ñ€Ð°Ð·" — нужно перекодировать обратно.
function fixUtf8(name) {
  if (!name) return name;
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function storage(subdir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, subdir),
    filename: (_req, file, cb) => {
      // Чиним кодировку прямо в объекте: дальше его читают и messages.js,
      // и любой другой обработчик — все увидят корректное имя.
      file.originalname = fixUtf8(file.originalname);
      const ext = path.extname(file.originalname) || extFromMime(file.mimetype) || '.bin';
      const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext.toLowerCase()}`;
      cb(null, name);
    },
  });
}

// Лимиты на «мелкие» типы. Раньше были захардкожены; вынесены, потому что
// разумное значение зависит от инстанса — например, где голосовые
// сообщения основной способ общения, 15 МБ может быть мало.
function mbEnv(name, fallback) {
  const n = Number(process.env[name]);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * 1024 * 1024;
}

export const AVATAR_MAX_BYTES = mbEnv('AVATAR_MAX_MB', 3);
export const VOICE_MAX_BYTES = mbEnv('VOICE_MAX_MB', 15); // 15 МБ ≈ 15+ минут сжатого аудио

export const uploadAvatar = multer({
  storage: storage(avatarsDir),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('only images'));
    cb(null, true);
  },
});

export const uploadVoice = multer({
  storage: storage(voiceDir),
  limits: { fileSize: VOICE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^audio\//.test(file.mimetype)) return cb(new Error('only audio'));
    cb(null, true);
  },
});

// Любой файл (фото/видео/документы). По умолчанию — 500 МБ,
// можно поднять/опустить через переменную окружения MAX_UPLOAD_MB
// (например, MAX_UPLOAD_MB=2048 = 2 ГБ).
// Имя на диске генерируется случайно, но оригинальное имя сохраняется в БД.
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 500);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const uploadAttachment = multer({
  storage: storage(filesDir),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Express middleware: после multer-а гоняем файл через normalizeUpload и,
// если требуется, проверяем группу. Удобно цеплять как `[uploadAvatar.single, sniff('image')]`.
export function sniff(group = null) {
  return (req, _res, next) => {
    try {
      if (req.file) normalizeUpload(req.file, group);
      if (req.files) {
        if (Array.isArray(req.files)) {
          for (const f of req.files) normalizeUpload(f, group);
        } else {
          for (const arr of Object.values(req.files)) {
            for (const f of arr) normalizeUpload(f, group);
          }
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function publicPathFor(absolutePath) {
  const rel = path.relative(UPLOADS_DIR, absolutePath).replace(/\\/g, '/');
  return `/uploads/${rel}`;
}

export function absolutePathFor(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const rel = publicPath.slice('/uploads/'.length);
  // безопасность: не выходим за пределы UPLOADS_DIR
  const abs = path.resolve(UPLOADS_DIR, rel);
  if (!abs.startsWith(UPLOADS_DIR)) return null;
  return abs;
}
