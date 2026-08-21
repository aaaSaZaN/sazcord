import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Settings,
  Loader2,
  Volume2,
  VolumeX,
  X,
  Maximize2,
  Minimize2,
  Phone,
} from 'lucide-react';
import Avatar from './Avatar';
import ScreenQualityModal from './ScreenQualityModal';
import { canShareScreen } from '../utils/media';
import { useSettings } from '../context/SettingsContext';
import { formatDuration, getAvatarUrl, getDisplayName } from '../utils/user';
import { applySinkId } from '../utils/audioSink';

const SettingsPanel = lazy(() => import('./SettingsPanel'));

type StreamVideoProps = {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
  mirror?: boolean;
};

const StreamVideo = memo(function StreamVideo({
  stream,
  muted = false,
  className = '',
  mirror = false,
}: StreamVideoProps) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
});

/**
 * Отдельный невидимый audio-элемент для удалённого звука.
 * Нужен, т.к. без видео звука у `<video>` может не быть, а также
 * чтобы применять outputDeviceId через setSinkId и управлять громкостью.
 */
type RemoteAudioProps = {
  stream: MediaStream | null;
  sinkId?: string;
  volume?: number;
  muted?: boolean;
};

const RemoteAudio = memo(function RemoteAudio({
  stream,
  sinkId,
  volume,
  muted = false,
}: RemoteAudioProps) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream || null;
    }
    if (stream) {
      el.play?.().catch(() => {
        /* autoplay policy — пользователь ещё кликнет */
      });
    }
  }, [stream]);

  // Громкость и mute накладываем ТОЛЬКО на сам <audio>. Трогать
  // track.enabled на receiver-стороне нельзя: тот же MediaStreamTrack
  // читает useSpeakingDetector (AnalyserNode), и если выключить трек,
  // зелёная рамка «говорит» перестанет работать у deafen-нутого. Видео-
  // элемент с тем же стримом замьючен через muted-проп (см. вызов выше),
  // так что аудио-канал у нас единственный — этот <audio>.
  // Зависим от stream защитно — на случай браузерного квирка при смене
  // srcObject; идемпотентная переустановка свойств не вредит.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // volume — уже нормализованный коэффициент 0..1 (как в GroupCallView).
    el.volume = Math.max(0, Math.min(1, volume ?? 1));
    el.muted = !!muted;
  }, [stream, muted, volume]);

  useEffect(() => {
    const el = ref.current;
    applySinkId(el, sinkId);
  }, [sinkId]);

  return <audio ref={ref} autoPlay playsInline />;
});

// `embedded` режим — вместо fullscreen-overlay рендерим CallView как
// обычный flex-блок, который занимает выделенный сверху чата кусок.
// Это нужно для дискорд-подобной схемы, где звонок виден ВНУТРИ чата:
// можно одновременно и говорить, и листать сообщения / переключать
// контакты. Для совместимости проп опциональный — снаружи (Home.tsx)
// мы всегда отдаём embedded=true.
export default function CallView({
  call,
  embedded = false,
  selfUser = null,
}: {
  call: any;
  embedded?: boolean;
  selfUser?: any;
}) {
  const { settings, update } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [streamVolumeMenu, setStreamVolumeMenu] = useState(null);
  const [, tick] = useState(0);
  // Фуллскрин для удалённого стрима. Цепляемся к враппер-диву (а не к
  // самому <video>) — так пользователь видит всю плашку и оверлеи поверх,
  // а не голую видеокартинку без управления.
  const remoteWrapperRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const {
    state,
    peer,
    localStream,
    remoteStream,
    muted,
    deafened,
    cameraOn,
    sharingScreen,
    peerMedia,
    waitingUntil,
    selfLeft,
    speakingUserIds,
    selfId,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    hangup,
    rejoinAsCaller,
  } = call;

  // Зелёная подсветка вокруг плитки/превью, когда участник реально говорит.
  // Self подсвечиваем только если микрофон включён — иначе сбивает с толку
  // (трек выключен, но AnalyserNode иногда ловит остаточный шум).
  const peerSpeaking = speakingUserIds?.has?.(peer?.id) === true;
  const selfSpeaking = !muted && speakingUserIds?.has?.(selfId) === true;

  // Тикалка для обновления countdown в waiting.
  useEffect(() => {
    if (state !== 'waiting') return undefined;
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [state]);

  // Подписка на нативное событие fullscreenchange — пользователь может
  // выйти из фуллскрина клавишей Esc, и наш state должен это знать.
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(document.fullscreenElement === remoteWrapperRef.current);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = () => {
    const el = remoteWrapperRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        document.exitFullscreen?.();
      } else {
        const req =
          el.requestFullscreen ||
          (el as any).webkitRequestFullscreen ||
          (el as any).msRequestFullscreen;
        req?.call(el);
      }
    } catch {
      /* not supported / denied */
    }
  };

  if (state === 'idle' || state === 'incoming') return null;

  const waiting = state === 'waiting';
  // Показываем удалённое видео ТОЛЬКО если пир явно включил камеру/экран.
  // Без этого `<video>` будет чёрным квадратом, т.к. receiver-трек всегда есть.
  const showRemoteVideo = !waiting && !!(peerMedia?.camera || peerMedia?.screen);
  const hasLocalVideo = cameraOn || sharingScreen;
  const peerId = peer?.id;
  const peerUserVolume = peerId ? (settings.userVolumes?.[peerId] ?? 100) : 100;
  const peerStreamVolume = peerId ? (settings.streamVolumes?.[peerId] ?? 100) : 100;

  const waitLeft = waiting && waitingUntil ? Math.max(0, waitingUntil - Date.now()) : 0;

  const label =
    state === 'calling'
      ? 'Исходящий вызов…'
      : state === 'connecting'
        ? 'Соединение…'
        : state === 'waiting'
          ? selfLeft
            ? `Вы вышли из звонка · ${formatDuration(waitLeft)}`
            : `Собеседник отключился · ${formatDuration(waitLeft)}`
          : 'В разговоре';

  // В embedded-режиме оставляем bg прозрачным — звонок «вписан» в общий
  // фон main-панели. Border снизу нужен, чтобы визуально отделить блок
  // звонка от чата под ним. В fullscreen-режиме (не используется сейчас,
  // но осталось для совместимости) сохраняем поведение старого оверлея.
  const rootClass = embedded
    ? 'relative w-full h-full flex flex-col bg-bg-0 border-b border-border min-h-0'
    : 'fixed inset-0 z-40 bg-bg-0 flex flex-col';

  return (
    <div className={rootClass}>
      {/* Поток */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        {/* Раньше тут была зелёная inset-рамка вокруг ВСЕЙ зоны звонка,
            когда мы говорим. По фидбеку убрана: visual-cue говорящего
            переехал на сами аватарки (см. ниже peerSpeakingRing /
            selfSpeakingRing). Это явнее показывает кто именно говорит. */}
        {showRemoteVideo ? (
          <div
            ref={remoteWrapperRef}
            className="absolute inset-0 group bg-black"
            onContextMenu={(e) => {
              if (!peerId) return;
              e.preventDefault();
              setStreamVolumeMenu({ x: e.clientX, y: e.clientY });
            }}
            onDoubleClick={toggleFullscreen}
          >
            <StreamVideo
              key={`${peerMedia?.camera ? 'c' : ''}${peerMedia?.screen ? 's' : ''}`}
              stream={remoteStream}
              muted
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
            {/* Внутренняя рамка-overlay поверх видео — рисуем через ring
                на абсолютном слое, чтобы не сдвигать саму картинку. */}
            <div
              aria-hidden
              className={`absolute inset-0 pointer-events-none transition-shadow duration-150 ${
                peerSpeaking
                  ? 'shadow-[inset_0_0_0_3px_rgba(16,185,129,0.85),inset_0_0_22px_2px_rgba(16,185,129,0.45)]'
                  : 'shadow-none'
              }`}
            />
            {/* Кнопка фуллскрина — появляется в правом верхнем углу при
                наведении на видео-плашку. Двойной клик по самой плашке —
                алиас (как в YouTube). */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="absolute top-4 right-4 z-20 btn-icon bg-black/60 hover:bg-black/80 text-white border border-white/10 backdrop-blur opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              style={{ width: 40, height: 40 }}
              title={isFullscreen ? 'Выйти из полноэкранного режима' : 'Развернуть на весь экран'}
              aria-label={isFullscreen ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        ) : (
          <div
            className="absolute inset-0 grid place-items-center px-4"
            onContextMenu={(e) => {
              if (!peerId) return;
              e.preventDefault();
              setStreamVolumeMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <div className="flex flex-col items-center gap-4 text-center w-full">
              {/* Две аватарки: пир + я. Зелёный ring — на самой аватарке
                  того, кто прямо сейчас говорит (Discord-like). Размер
                  адаптивный, но не меньше 96px — чтобы при минимальной
                  высоте панели (≈ avatar+40px по фидбеку) аватарки всё
                  ещё были крупными и читаемыми. */}
              <div className="flex items-center justify-center gap-6 sm:gap-10">
                <AvatarTile
                  user={peer}
                  fallbackName={getDisplayName(peer) || '?'}
                  speaking={peerSpeaking}
                  dim={waiting}
                  micOff={state === 'in-call' && peerMedia && !peerMedia.mic}
                  deafenedOff={state === 'in-call' && !!peerMedia?.deafened}
                />
                <AvatarTile
                  user={selfUser}
                  fallbackName={getDisplayName(selfUser) || 'Вы'}
                  selfLabel
                  speaking={selfSpeaking}
                  micOff={muted}
                  deafenedOff={deafened}
                />
              </div>
              <div>
                <div
                  className={`text-sm flex items-center justify-center gap-1.5 ${
                    waiting ? 'text-amber-300' : 'text-slate-400'
                  }`}
                >
                  {waiting && <Loader2 size={14} className="animate-spin" />}
                  <span>{label}</span>
                </div>
                {waiting && (
                  <div className="mt-2 text-xs text-slate-500 max-w-xs">
                    {selfLeft
                      ? 'Окно звонка останется открытым, пока собеседник ждёт. Нажмите «Подключиться», чтобы вернуться в звонок.'
                      : 'Если собеседник вернётся в течение этого времени — соединение восстановится автоматически.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Remote audio (воспроизводится всегда, когда есть stream). */}
        <RemoteAudio
          stream={remoteStream}
          sinkId={settings.outputDeviceId}
          // Мастер-громкость динамиков применялась только в групповых
          // звонках — в 1:1 ползунок «Громкость» из настроек не работал.
          volume={
            (settings.outputVolume ?? 1) *
            Math.max(
              0,
              Math.min(1, (peerMedia?.screenAudio ? peerStreamVolume : peerUserVolume) / 100),
            )
          }
          muted={deafened && !peerMedia?.screenAudio}
        />

        {/* Локальное превью */}
        {hasLocalVideo && (
          <div
            className={`absolute bottom-4 right-4 w-40 sm:w-56 aspect-video rounded-xl overflow-hidden border-2 bg-bg-2 shadow-soft transition-colors duration-100 ${
              selfSpeaking
                ? 'border-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.45),0_0_18px_2px_rgba(16,185,129,0.35)]'
                : 'border-border'
            }`}
          >
            <StreamVideo
              stream={localStream}
              muted
              mirror={cameraOn && !sharingScreen}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Плашка-статус */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <div className="px-3 py-1.5 text-xs rounded-full bg-black/60 backdrop-blur border border-white/10">
            {label}
          </div>
          {showRemoteVideo && (
            <div className="px-3 py-1.5 text-xs rounded-full bg-black/60 backdrop-blur border border-white/10 flex items-center gap-2">
              <Avatar name={getDisplayName(peer) || '?'} src={getAvatarUrl(peer)} size={20} />
              <span>{getDisplayName(peer)}</span>
              {peerMedia?.deafened && <VolumeX size={12} className="text-amber-400" />}
              {!peerMedia?.mic && <MicOff size={12} className="text-amber-400" />}
            </div>
          )}
        </div>
      </div>

      {/* Контролы */}
      <div className="p-4 flex items-center justify-center gap-3 bg-bg-1 border-t border-border">
        <ToolButton
          onClick={toggleMute}
          active={muted}
          activeDanger
          title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
        >
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
        </ToolButton>
        <ToolButton
          onClick={toggleDeafen}
          active={deafened}
          activeDanger
          title={deafened ? 'Включить звук собеседника' : 'Заглушить собеседника (только у вас)'}
        >
          {deafened ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </ToolButton>
        <ToolButton
          onClick={toggleCamera}
          active={cameraOn}
          title={cameraOn ? 'Выключить камеру' : 'Включить камеру'}
        >
          {cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
        </ToolButton>
        {/* Android WebView не реализует getDisplayMedia — там кнопку не
            рисуем вовсе, чтобы она не «нажималась в пустоту».
            См. canShareScreen в utils/media.ts. */}
        {canShareScreen() && (
          <ToolButton
            onClick={() => {
              if (sharingScreen) toggleScreenShare();
              else setQualityOpen(true);
            }}
            active={sharingScreen}
            title={sharingScreen ? 'Остановить демонстрацию' : 'Показать экран / окно'}
          >
            {sharingScreen ? <MonitorOff size={20} /> : <Monitor size={20} />}
          </ToolButton>
        )}
        <ToolButton onClick={() => setSettingsOpen(true)} title="Настройки звука">
          <Settings size={20} />
        </ToolButton>
        {waiting && selfLeft ? (
          // Leaver: мы сами нажали End и сейчас вне звонка. Зелёная
          // Connect → rejoinAsCaller → server-side rebindForRejoin
          // (см. callRegistry.js) переиспользует waiting-звонок,
          // пир авто-принимает если он тоже в waiting.
          <button
            type="button"
            onClick={() => {
              void rejoinAsCaller?.();
            }}
            className="btn-icon bg-emerald-500 hover:bg-emerald-400 text-white ml-2"
            style={{ width: 52, height: 52 }}
            title="Подключиться к звонку"
            aria-label="Подключиться к звонку"
          >
            <Phone size={22} />
          </button>
        ) : (
          // Базовая End-кнопка — для:
          //   • in-call / connecting: покинуть звонок (уйдём в waiting
          //     через hangup → enterWaiting(true); окно остаётся);
          //   • waiting + !selfLeft (ПИР ушёл, я остался): End =
          //     «завершить ожидание». hangup → cleanup → idle; сервер
          //     finalize → forward call:end пиру → его окно тоже закроется.
          <button
            onClick={() => hangup()}
            className="btn-icon bg-danger hover:bg-danger-hover text-white ml-2"
            style={{ width: 52, height: 52 }}
            title={
              waiting
                ? 'Завершить ожидание и закрыть окно'
                : 'Покинуть звонок (окно останется до возврата собеседника)'
            }
          >
            <PhoneOff size={22} />
          </button>
        )}
      </div>

      <Suspense fallback={null}>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </Suspense>
      <ScreenQualityModal
        open={qualityOpen}
        defaultPreset={settings.screenQuality || '720p'}
        onClose={() => setQualityOpen(false)}
        onConfirm={(preset, includeAudio) => {
          setQualityOpen(false);
          toggleScreenShare(preset, includeAudio);
        }}
      />

      {/* Меню громкости. В фуллскрин-режиме порталим внутрь
          `document.fullscreenElement`, иначе «фиксированная» плашка
          попадает в DOM, который в топ-лейере fullscreen НЕ виден —
          пользователю приходилось выходить из фуллскрина. createPortal
          в таргет = fullscreenElement кладёт меню в тот же top-layer,
          куда попадает fullscreen-контейнер. Координаты из clientX/Y
          в обоих режимах остаются от вьюпорта. */}
      {streamVolumeMenu &&
        peerId &&
        createPortal(
          <>
            <div
              className="fixed z-[90] bg-bg-1 border border-border rounded-lg shadow-xl p-4 w-64"
              style={{ left: streamVolumeMenu.x, top: streamVolumeMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium truncate pr-2">
                  Громкость · {getDisplayName(peer)}
                </span>
                <button
                  onClick={() => setStreamVolumeMenu(null)}
                  className="text-slate-400 hover:text-white"
                  aria-label="Закрыть меню громкости"
                >
                  <X size={16} />
                </button>
              </div>
              <label className="block text-xs text-slate-400 mb-1">Пользователь</label>
              <input
                type="range"
                min="0"
                max="100"
                value={peerUserVolume}
                onChange={(e) => {
                  const newValue = Number(e.target.value);
                  update({ userVolumes: { ...(settings.userVolumes || {}), [peerId]: newValue } });
                }}
                className="range w-full"
                aria-label="Громкость пользователя"
                style={{ '--range-progress': `${peerUserVolume}%` } as React.CSSProperties}
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>0%</span>
                <span>{peerUserVolume}%</span>
                <span>100%</span>
              </div>
              {peerMedia?.screenAudio && (
                <div className="mt-4">
                  <label className="block text-xs text-slate-400 mb-1">Стрим</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={peerStreamVolume}
                    onChange={(e) => {
                      const newValue = Number(e.target.value);
                      update({
                        streamVolumes: { ...(settings.streamVolumes || {}), [peerId]: newValue },
                      });
                    }}
                    className="range w-full"
                    aria-label="Громкость стрима"
                    style={{ '--range-progress': `${peerStreamVolume}%` } as React.CSSProperties}
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>0%</span>
                    <span>{peerStreamVolume}%</span>
                    <span>100%</span>
                  </div>
                </div>
              )}
            </div>
            <div className="fixed inset-0 z-[89]" onClick={() => setStreamVolumeMenu(null)} />
          </>,
          (isFullscreen && document.fullscreenElement) || document.body,
        )}
    </div>
  );
}

// Плитка аватарки в no-video зоне звонка. На самой аватарке висит
// «зелёный ring» когда участник говорит (Discord-стиль). Имя — под
// аватаркой, мелким шрифтом, чтобы плитка вписывалась в минимальную
// высоту звонка (avatar + 40px). Поддерживает selfLabel («Вы») и
// иконку выключенного микрофона в правом нижнем углу.
function AvatarTile({
  user,
  fallbackName,
  speaking = false,
  dim = false,
  selfLabel = false,
  micOff = false,
  deafenedOff = false,
}: {
  user: any;
  fallbackName: string;
  speaking?: boolean;
  dim?: boolean;
  selfLabel?: boolean;
  micOff?: boolean;
  deafenedOff?: boolean;
}) {
  const name = getDisplayName(user) || fallbackName;
  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <div className="relative">
        <div
          className={`rounded-full p-1 transition-shadow duration-150 ${dim ? 'opacity-60' : ''} ${
            speaking
              ? 'shadow-[0_0_0_3px_rgba(16,185,129,0.9),0_0_22px_4px_rgba(16,185,129,0.45)]'
              : ''
          }`}
        >
          <Avatar name={name} src={getAvatarUrl(user)} size={112} />
        </div>
        {micOff && (
          <div
            className="absolute -bottom-1 -right-1 grid place-items-center rounded-full bg-bg-1 border border-border"
            style={{ width: 28, height: 28 }}
            aria-label="Микрофон выключен"
            title="Микрофон выключен"
          >
            <MicOff size={14} className="text-amber-400" />
          </div>
        )}
        {deafenedOff && (
          // Слева от mic-off, чуть наезжая на аватар (right=22 вместо -4 =
          // бадж mic-off·28px ширины + 6px перекрытие). Если mic-off нет —
          // deafen всё равно рисуется в своём месте (визуально ок, подразумевается
          // что mic-бадж «бы был» справа).
          <div
            className="absolute -bottom-1 grid place-items-center rounded-full bg-bg-1 border border-border"
            style={{ width: 28, height: 28, right: micOff ? 22 : -4 }}
            aria-label="Наушники выключены"
            title="Наушники выключены"
          >
            <VolumeX size={14} className="text-amber-400" />
          </div>
        )}
      </div>
      <div className="text-sm font-medium truncate max-w-[160px]">
        {name}
        {selfLabel && <span className="text-slate-400"> (вы)</span>}
      </div>
    </div>
  );
}

function ToolButton({ onClick, active = false, activeDanger = false, title, children }) {
  const base = 'btn-icon transition-colors';
  const style = active
    ? activeDanger
      ? 'bg-danger hover:bg-danger-hover text-white'
      : 'bg-accent hover:bg-accent-hover text-white'
    : 'bg-bg-3 hover:bg-bg-2 text-slate-100';
  return (
    <button
      onClick={onClick}
      title={title}
      className={`${base} ${style}`}
      style={{ width: 48, height: 48 }}
    >
      {children}
    </button>
  );
}
