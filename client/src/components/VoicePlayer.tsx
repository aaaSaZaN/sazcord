import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { formatDuration } from '../utils/user';
import { useSettings } from '../context/SettingsContext';
import { applySinkId } from '../utils/audioSink';

/**
 * Проигрыватель голосовых сообщений в чате.
 * Использует outputDeviceId / outputVolume из настроек.
 */
export default function VoicePlayer({ src, durationMs, mine }) {
  const { settings } = useSettings();
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);
  const [total, setTotal] = useState(durationMs ? durationMs / 1000 : 0);
  const rescuedRef = useRef(false);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.volume = Math.max(0, Math.min(1, settings.outputVolume ?? 1));
  }, [settings.outputVolume]);

  useEffect(() => {
    applySinkId(ref.current, settings.outputDeviceId);
  }, [settings.outputDeviceId]);

  // Сторож залипшего вывода. Если элемент считает себя играющим, а
  // currentTime не двигается ~1.5 с — значит sink мёртв (типовой случай:
  // сохранённый outputDeviceId указывает на исчезнувшее устройство, и
  // Chromium/Electron молча вешает аудио-рендерер). Один раз перекидываем
  // звук на системный вывод и продолжаем воспроизведение.
  useEffect(() => {
    if (!playing) return;
    let last = ref.current?.currentTime ?? 0;
    let stuck = 0;
    const id = setInterval(async () => {
      const a = ref.current;
      if (!a || a.paused || a.ended) return;
      const now = a.currentTime;
      stuck = now > last ? 0 : stuck + 1;
      last = now;
      if (stuck >= 3 && !rescuedRef.current) {
        rescuedRef.current = true;
        console.warn('[voice] playback stalled, resetting to default sink', src);
        await applySinkId(a, null);
        a.play().catch(() => {
          setPlaying(false);
          setFailed(true);
        });
      }
    }, 500);
    return () => clearInterval(id);
  }, [playing, src]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      // Ошибку play() не глотаем: без этого битый/неподдерживаемый файл
      // выглядит как «нажал и ничего», а кнопка остаётся в состоянии Pause.
      a.play().catch((e) => {
        console.error('[voice] play failed', src, e);
        setPlaying(false);
        setFailed(true);
      });
    } else {
      a.pause();
    }
  };

  const onLoaded = () => {
    const d = ref.current?.duration;
    if (d && Number.isFinite(d)) setTotal(d);
  };

  const onTime = () => {
    const c = ref.current?.currentTime || 0;
    setCurrent(c);
  };

  const onError = () => {
    const err = ref.current?.error;
    console.error('[voice] media error', src, err?.code, err?.message);
    setPlaying(false);
    setFailed(true);
  };

  const onEnded = () => {
    setPlaying(false);
    setCurrent(0);
  };

  const percent = total ? Math.min(100, (current / total) * 100) : 0;

  const onSeek = (e) => {
    const a = ref.current;
    if (!a || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    const ratio = rect.width ? x / rect.width : 0;
    a.currentTime = ratio * total;
    setCurrent(a.currentTime);
  };

  return (
    <div className="flex items-center gap-3 min-w-[200px] max-w-[280px]">
      <button
        onClick={toggle}
        className={`btn-icon shrink-0 ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-bg-3 hover:bg-bg-1'}`}
        style={{ width: 36, height: 36 }}
        title={playing ? 'Пауза' : 'Воспроизвести'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={`h-2 rounded-full cursor-pointer ${mine ? 'bg-white/20' : 'bg-bg-3'}`}
          onClick={onSeek}
        >
          <div
            className={`h-full rounded-full ${mine ? 'bg-white' : 'bg-accent'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div
          className={`text-[11px] mt-1 tabular-nums ${mine ? 'text-white/80' : 'text-slate-400'}`}
        >
          {failed ? (
            'не удалось воспроизвести'
          ) : (
            <>
              {formatDuration(current * 1000)}
              {' / '}
              {formatDuration(total * 1000)}
            </>
          )}
        </div>
      </div>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={onLoaded}
        onDurationChange={onLoaded}
        onTimeUpdate={onTime}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={onEnded}
        onError={onError}
      />
    </div>
  );
}
