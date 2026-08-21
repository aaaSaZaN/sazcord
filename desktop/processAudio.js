// Per-application audio loopback для шеринга экрана.
//
// Зачем:
//   Стандартный `audio: 'loopback'` в setDisplayMediaRequestHandler
//   Electron'а захватывает ВЕСЬ системный микшер — звук всех браузеров,
//   мессенджеров, музыкальных плееров вместе с целевым приложением.
//   Юзер хочет: при шеринге окна игры — слышен только звук игры.
//
//   Технически это решается через WASAPI process-loopback (Windows 10+),
//   API `ActivateAudioInterfaceAsync` с `ProcessLoopbackParams`. Готовая
//   обёртка — npm-пакет `application-loopback`: внутри спавнит
//   ApplicationLoopback.exe (C++ самплер из microsoft/Windows-classic-
//   samples), который пишет raw PCM в stdout. Мы читаем чанки и пушим
//   в renderer через IPC; там они превращаются в MediaStreamTrack
//   и подцепляются к screen-share стриму.
//
// Платформа:
//   - Windows: работает.
//   - macOS: пакет no-op'ит на не-x64-Windows. Возвращаем null/false из
//     всех методов — main fallback'ится на 'loopback' (system mixer).
//   - Linux: то же самое.
//
// Формат PCM:
//   Microsoft sample (Windows-classic-samples / ApplicationLoopback) ХАРДКОДИТ
//   m_CaptureFormat в LoopbackCapture.cpp:
//     wFormatTag      = WAVE_FORMAT_PCM   (signed int16)
//     nChannels       = 2
//     nSamplesPerSec  = 44100
//     wBitsPerSample  = 16
//   То есть бинарник пишет в stdout СТЕРЕО PCM 44.1kHz int16 LE,
//   независимо от mix format'а endpoint'а. Это его прихоть, мы её
//   эксплуатируем — формат стабильный, sniff не нужен.
//
//   Renderer создаёт AudioContext с sampleRate=44100 и в onChunk
//   нормирует int16 в float32 (см. media.ts → attachProcessAudioToDisplay).

const { EventEmitter } = require('node:events');
const path = require('node:path');

// Формат PCM, в котором бинарник ApplicationLoopback.exe пишет в stdout.
// Источник: github.com/microsoft/Windows-classic-samples →
// Samples/ApplicationLoopback/cpp/LoopbackCapture.cpp.
const PCM_FORMAT = Object.freeze({
  sampleRate: 44100,
  channels: 2,
  encoding: 'int16',
  bytesPerSample: 2,
});

let lib = null;
let libError = null;
let libResolved = false;

// Ленивый require пакета: на не-Windows он печатает warn в console,
// но не падает; нам важно не падать на старте main процесса.
//
// В production-сборке (electron-builder + asar) у этого пакета есть
// специфическая засада. Сам пакет резолвит свои .exe относительно
// __dirname (см. application-loopback/dist/index.cjs):
//   path.resolve(__dirname, '../bin', 'win32-x64', 'ProcessList.exe')
// __dirname в нашем installer'е указывает внутрь app.asar, то есть путь
// получается:
//   <install>/resources/app.asar/node_modules/application-loopback/bin/win32-x64/ProcessList.exe
// child_process.spawn() оттуда невозможен — asar это архив, не папка,
// и Electron возвращает ENOENT (см. диалог «JavaScript error in main
// process» при попытке шеринга окна). Бинарники физически лежат в
// app.asar.unpacked (благодаря asarUnpack-паттерну в package.json), но
// сам пакет об этом не знает.
//
// Лечим через экспортируемый пакетом setExecutablesRoot(): передаём
// ему путь, в котором 'app.asar' заменён на 'app.asar.unpacked'. Это
// безопасно и в dev (там app.asar в пути нет — replace no-op'ит).
//
// Дополнительно проверяем fs.existsSync на самом exe: антивирус (Defender,
// Kaspersky и т. п.) часто удаляет ApplicationLoopback.exe и ProcessList.exe
// потому что они unsigned-семплы из microsoft/Windows-classic-samples. Если
// файла нет — отдаём null, и captureDisplay fall'кается на встроенный
// chromium-loopback (системный микшер) вместо краша всего приложения.
function getLib() {
  if (libResolved) return lib;
  libResolved = true;
  if (process.platform !== 'win32') {
    libError = new Error(`process audio loopback unavailable on ${process.platform}`);
    return null;
  }
  try {
    lib = require('application-loopback');
  } catch (e) {
    libError = e;
    lib = null;
    return null;
  }
  try {
    const { app } = require('electron');
    if (app && app.isPackaged && typeof lib.setExecutablesRoot === 'function') {
      const fs = require('node:fs');
      // Дефолтный корень пакета: <module>/bin (см. dist/index.cjs).
      // require.resolve даёт путь до index.cjs внутри asar.
      const defaultBin = path.resolve(
        path.dirname(require.resolve('application-loopback')),
        '..',
        'bin',
      );
      const unpackedBin = defaultBin.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
      );
      if (unpackedBin !== defaultBin) {
        lib.setExecutablesRoot(unpackedBin);
      }
      // Проверяем наличие хотя бы одного exe — если AV их удалил, проще
      // сразу отказаться от per-process loopback'а, чем падать на spawn.
      const probeExe = path.resolve(unpackedBin, 'win32-x64', 'ProcessList.exe');
      if (!fs.existsSync(probeExe)) {
        libError = new Error(
          `application-loopback binary missing at ${probeExe} ` +
            `(antivirus quarantine or broken install). ` +
            `Per-process audio capture disabled, falling back to system loopback.`,
        );
        console.warn('[procAudio]', libError.message);
        lib = null;
        return null;
      }
    }
  } catch (e) {
    // Не критично: пакет может работать и без подмены root'а (dev-режим
    // или неожиданная структура). Сохраняем lib и идём дальше.
    console.warn('[procAudio] setExecutablesRoot setup failed (non-fatal):', e);
  }
  return lib;
}

class ProcessAudioCapture extends EventEmitter {
  constructor() {
    super();
    /** @type {string | null} текущий захватываемый PID, либо null */
    this.activePid = null;
    /** @type {boolean} флаг, чтобы не дёргать stop повторно */
    this.stopping = false;
  }

  /**
   * Доступен ли вообще per-process loopback на этой ОС.
   */
  isSupported() {
    return getLib() !== null;
  }

  /**
   * Описание формата PCM, который будут пушить чанки 'chunk'.
   */
  getFormat() {
    return PCM_FORMAT;
  }

  /**
   * Сейчас идёт активный захват? Renderer спрашивает это сразу после
   * getDisplayMedia, чтобы понять: использовать chromium-loopback,
   * пришедший в audio-track'е, или подменить его на наш PCM-track.
   */
  isActive() {
    return this.activePid !== null;
  }

  /**
   * По HWND (как в `desktopCapturer.getSources()` для window-источника)
   * найти PID. application-loopback внутри спавнит ProcessList.exe и
   * собирает HWND/PID/title для всех видимых окон.
   *
   * @param {string|number} hwnd
   * @returns {Promise<string|null>} PID строкой или null если не нашли
   */
  async findPidByHwnd(hwnd) {
    const l = getLib();
    if (!l) return null;
    if (hwnd === null || hwnd === undefined) return null;
    const target = String(hwnd);
    try {
      const windows = await l.getActiveWindowProcessIds();
      const found = windows.find((w) => String(w.hwnd) === target);
      return found ? String(found.processId) : null;
    } catch (e) {
      console.error('[procAudio] getActiveWindowProcessIds failed:', e);
      return null;
    }
  }

  /**
   * Стартует захват по PID. Если уже идёт захват для другого PID —
   * предварительно стопает его (одновременно может быть только один
   * захват, потому что mainWindow один и аудио-эффект один в звонке).
   *
   * Эмиттит:
   *   'chunk' (Buffer | Uint8Array) — каждые ~10-20 мс пачка PCM.
   *   'ended' () — захват штатно остановлен.
   *   'error' (Error) — что-то пошло не так (бинарник сдох и т.п.).
   *
   * @param {string|number} pid
   * @returns {Promise<boolean>} true если стартанули.
   */
  async start(pid) {
    const l = getLib();
    if (!l) return false;
    if (pid === null || pid === undefined) return false;
    const pidStr = String(pid);

    // Уже захватываем тот же процесс — не трогаем.
    if (this.activePid === pidStr) return true;

    // Захватывали другой процесс — остановим, чтобы не дублировать
    // child-процессы и не путаться, чьи чанки летят.
    if (this.activePid) await this.stop();

    try {
      l.startAudioCapture(pidStr, {
        onData: (data) => {
          // application-loopback отдаёт Uint8Array; пробрасываем как Buffer
          // (он уже Buffer-совместимый — Electron IPC сериализует обоих
          // одинаково в structured clone).
          this.emit('chunk', data);
        },
      });
      this.activePid = pidStr;
      this.stopping = false;
      return true;
    } catch (e) {
      console.error('[procAudio] startAudioCapture failed:', e);
      this.emit('error', e);
      return false;
    }
  }

  /**
   * Останавливает текущий захват, если он есть. Идемпотентно.
   * @returns {Promise<boolean>} true если был активный захват и его
   *                             остановили.
   */
  async stop() {
    const l = getLib();
    if (!l) return false;
    if (!this.activePid) return false;
    if (this.stopping) return false;
    this.stopping = true;
    const pid = this.activePid;
    try {
      l.stopAudioCapture(pid);
    } catch (e) {
      console.warn('[procAudio] stopAudioCapture failed:', e);
    }
    this.activePid = null;
    this.stopping = false;
    this.emit('ended');
    return true;
  }
}

// Глобальный singleton — единственный консьюмер per-process audio в наше
// время это активный звонок, и одновременно у нас не больше одного
// шаринга окна.
const capture = new ProcessAudioCapture();

module.exports = {
  capture,
  PCM_FORMAT,
  // Экспонируем низкоуровневый getLib() для диагностики (UI настройки
  // могло бы дёргать isSupported() через IPC, чтобы заранее спрятать
  // тоггл звука для window-share, если ОС не поддерживает).
  isSupported: () => capture.isSupported(),
  getLastError: () => libError,
};
