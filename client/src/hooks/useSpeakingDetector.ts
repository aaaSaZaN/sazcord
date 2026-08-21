import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * useSpeakingDetector — детектор «активного говорящего» (voice-activity).
 *
 * На вход принимает карту `{ [userId]: MediaStream }` (либо `null`/без аудио-
 * треков — такие пропускаются). Создаёт один общий AudioContext и AnalyserNode
 * на каждый стрим, в `requestAnimationFrame`-цикле считает RMS и выставляет
 * пользователя как «говорящего», если текущий уровень громче порога. Чтобы
 * рамка не моргала на согласных и паузах между словами — отпускаем флаг с
 * задержкой `releaseMs` (hangover).
 *
 * Возвращает стабильный `Set<number>` userId-ов, которые сейчас говорят.
 *
 * Замечания:
 *  - анализ идёт ЛОКАЛЬНО для всех стримов (свой + удалённые), поэтому даже
 *    если пир замьютил себя, мы это правдиво увидим (его трек придёт пустым);
 *  - один AudioContext на хук — пересоздаётся только при изменении набора
 *    трек-ID (не на каждый rerender), чтобы не лагало WebRTC;
 *  - сэмплирование на rAF (~60 Гц), при свёрнутой вкладке браузер сам
 *    тормозит таймеры — нагрузка падает до нуля.
 */
export function useSpeakingDetector(
  streamsByUserId: Record<number, MediaStream> = {},
  {
    // RMS на short-time domain. Ниже ~0.005 — фоновый шум комнаты.
    // 0.012 ≈ -38 dBFS — нормальный голос на встроенном микрофоне.
    threshold = 0.012,
    // Сколько держать «говорит» после падения уровня — иначе моргает на
    // паузах между словами и на согласных.
    releaseMs = 250,
    // Полностью выключить (idle/после ухода из звонка), чтобы не держать
    // открытый AudioContext.
    enabled = true,
  } = {},
) {
  const [speaking, setSpeaking] = useState(() => new Set<number>());

  // Стабильная подпись по списку userId + id первого аудио-трека: если
  // кто-то из участников сменил микрофон — useEffect ниже пересоберёт
  // analyser'ы; если просто пришёл новый объект MediaStream с тем же
  // треком — ничего не делаем.
  const sig = useMemo(() => {
    const entries = Object.entries(streamsByUserId || {});
    const parts: string[] = [];
    for (const [uid, stream] of entries) {
      if (!stream) continue;
      const track = stream.getAudioTracks?.()[0];
      if (!track) continue;
      parts.push(`${uid}:${track.id}`);
    }
    parts.sort();
    return parts.join('|');
  }, [streamsByUserId]);

  // Свежий streamsByUserId внутрь useEffect через ref — чтобы effect
  // зависел только от `sig`, а не от объекта, мутирующего на каждом ререндере.
  const streamsRef = useRef(streamsByUserId);
  useEffect(() => {
    streamsRef.current = streamsByUserId;
  }, [streamsByUserId]);

  useEffect(() => {
    if (!enabled || !sig) {
      setSpeaking((prev) => (prev.size === 0 ? prev : new Set()));
      return undefined;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;

    const ctx = new Ctx();
    // userId -> { source, analyser, buffer, lastSpokeTs }
    const nodes = new Map<
      number,
      {
        source: MediaStreamAudioSourceNode;
        analyser: AnalyserNode;
        buffer: Float32Array<ArrayBufferLike>;
        lastSpokeTs: number;
      }
    >();

    const current = streamsRef.current || {};
    for (const [uidStr, stream] of Object.entries(current)) {
      if (!stream) continue;
      const tracks = stream.getAudioTracks?.() || [];
      if (!tracks.length) continue;
      try {
        // Берём только аудио-трек: createMediaStreamSource, по идее,
        // и так возьмёт audio, но с явным MediaStream безопаснее
        // (некоторые браузеры спотыкаются на video-only streams).
        const audioOnly = new MediaStream([tracks[0]]);
        const source = ctx.createMediaStreamSource(audioOnly);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        nodes.set(Number(uidStr), {
          source,
          analyser,
          buffer: new Float32Array(analyser.fftSize),
          lastSpokeTs: 0,
        });
      } catch {
        /* недоступный stream — пропускаем */
      }
    }

    let rafId = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      let changed = false;
      const next = new Set<number>();
      for (const [uid, node] of nodes) {
        node.analyser.getFloatTimeDomainData(node.buffer as any);
        // RMS текущего окна.
        let sum = 0;
        for (let i = 0; i < node.buffer.length; i += 1) {
          sum += node.buffer[i] * node.buffer[i];
        }
        const rms = Math.sqrt(sum / node.buffer.length);
        if (rms >= threshold) node.lastSpokeTs = now;
        if (now - node.lastSpokeTs <= releaseMs) next.add(uid);
      }
      setSpeaking((prev) => {
        if (prev.size !== next.size) {
          changed = true;
          return next;
        }
        for (const id of prev) {
          if (!next.has(id)) {
            changed = true;
            return next;
          }
        }
        return changed ? next : prev;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      for (const node of nodes.values()) {
        try {
          node.source.disconnect();
        } catch {
          /* */
        }
        try {
          node.analyser.disconnect();
        } catch {
          /* */
        }
      }
      ctx.close().catch(() => {
        /* */
      });
    };
  }, [sig, threshold, releaseMs, enabled]);

  return speaking;
}
