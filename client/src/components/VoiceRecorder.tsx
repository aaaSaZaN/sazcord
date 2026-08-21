import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Send, Trash2, Pause, Play } from 'lucide-react';
import { formatDuration } from '../utils/user';

function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

/**
 * Плавающая панель записи голосового над инпутом чата.
 * 3 состояния:
 *   - recording: идёт запись, таймер, кнопки "остановить" / "отменить"
 *   - preview: запись завершена, можно прослушать, отправить или удалить
 */
export default function VoiceRecorder({ onSend, onCancel, onError }) {
  const [phase, setPhase] = useState('recording'); // recording | preview | uploading
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [playing, setPlaying] = useState(false);

  const mediaStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef(null);
  const mimeRef = useRef('');
  const audioRef = useRef(null);

  // старт записи при монтировании
  useEffect(() => {
    let stopped = false;

    async function begin() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const mime = pickMime();
        mimeRef.current = mime;
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorderRef.current = rec;
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.onstop = () => {
          const type = mime || 'audio/webm';
          const b = new Blob(chunksRef.current, { type });
          chunksRef.current = [];
          setBlob(b);
          const url = URL.createObjectURL(b);
          setBlobUrl(url);
          setPhase('preview');
          // stop stream tracks
          mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        };
        rec.start(250);
        startedAtRef.current = Date.now();
        tickRef.current = setInterval(() => {
          setElapsed(Date.now() - startedAtRef.current);
        }, 200);
      } catch (e) {
        onError?.(e);
        onCancel?.();
      }
    }

    begin();

    return () => {
      stopped = true;
      if (tickRef.current) clearInterval(tickRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // очистка blobUrl
  useEffect(
    () => () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl],
  );

  const stop = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
  };

  const cancelAll = () => {
    stop();
    // если ещё идёт запись, просто отменяем и не переходим в preview
    if (phase === 'recording') {
      // дадим onstop сработать, но затем проигнорируем результат
      setTimeout(() => {
        setBlob(null);
      }, 0);
    }
    onCancel?.();
  };

  const send = async () => {
    if (!blob) return;
    setPhase('uploading');
    try {
      await onSend(blob, elapsed);
    } catch (e) {
      onError?.(e);
      setPhase('preview');
    }
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().catch(() => {});
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-2">
      {phase === 'recording' && (
        <>
          <span className="relative flex items-center gap-2 text-red-400 shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <Mic size={16} />
          </span>
          <span className="flex-1 text-sm tabular-nums">{formatDuration(elapsed)}</span>
          <button
            onClick={cancelAll}
            className="btn-icon bg-bg-3 hover:bg-bg-1 text-slate-200"
            style={{ width: 36, height: 36 }}
            title="Отменить"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={stop}
            className="btn-icon bg-accent hover:bg-accent-hover text-white"
            style={{ width: 36, height: 36 }}
            title="Остановить запись"
          >
            <Square size={16} />
          </button>
        </>
      )}

      {phase !== 'recording' && blobUrl && (
        <>
          <button
            onClick={togglePlay}
            className="btn-icon bg-bg-3 hover:bg-bg-1 text-slate-100 shrink-0"
            style={{ width: 36, height: 36 }}
            title={playing ? 'Пауза' : 'Прослушать'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <span className="flex-1 text-sm text-slate-300 tabular-nums">
            {formatDuration(elapsed)}
          </span>
          <audio
            ref={audioRef}
            src={blobUrl}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            preload="auto"
          />
          <button
            onClick={cancelAll}
            className="btn-icon bg-bg-3 hover:bg-bg-1 text-slate-200"
            style={{ width: 36, height: 36 }}
            title="Удалить"
            disabled={phase === 'uploading'}
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={send}
            disabled={phase === 'uploading'}
            className="btn-icon bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
            style={{ width: 36, height: 36 }}
            title="Отправить"
          >
            <Send size={16} />
          </button>
        </>
      )}
    </div>
  );
}
