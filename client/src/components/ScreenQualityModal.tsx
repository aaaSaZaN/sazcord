import { useState, useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, Monitor, Info, Sparkles, Sliders, Volume2, Check } from 'lucide-react';
import {
  RESOLUTION_PRESETS,
  DEFAULT_SCREEN_CONFIG,
  type ScreenQualityConfig,
  type ScreenResolution,
} from '../utils/media';
import { getDesktopPlatform, isDesktop } from '../utils/desktop';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';

const STORAGE_KEY = 'sazcord.screenQuality';

function loadSavedConfig(): { config: ScreenQualityConfig; includeAudio: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        config: {
          resolution: parsed.resolution || DEFAULT_SCREEN_CONFIG.resolution,
          frameRate: parsed.frameRate || DEFAULT_SCREEN_CONFIG.frameRate,
          bitrateMbps: parsed.bitrateMbps || DEFAULT_SCREEN_CONFIG.bitrateMbps,
        },
        includeAudio: !!parsed.includeAudio,
      };
    }
  } catch {
    /* ignore */
  }
  return { config: DEFAULT_SCREEN_CONFIG, includeAudio: false };
}

function saveConfig(config: ScreenQualityConfig, includeAudio: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, includeAudio }));
  } catch {
    /* ignore */
  }
}

const RESOLUTIONS: { id: ScreenResolution; label: string; desc: string }[] = [
  { id: 'source', label: 'Оригинал', desc: 'Без масштабирования' },
  { id: '4k', label: '4K (2160p)', desc: '3840×2160' },
  { id: '1440p', label: '2K (1440p)', desc: '2560×1440' },
  { id: '1080p', label: '1080p', desc: '1920×1080 Full HD' },
  { id: '720p', label: '720p', desc: '1280×720 HD' },
  { id: '480p', label: '480p', desc: '854×480 SD' },
];

const FPS_OPTIONS = [15, 30, 60, 120];
const BITRATE_PRESETS = [4, 8, 12, 18, 25, 40];

type ScreenQualityModalProps = {
  open: boolean;
  isLive?: boolean;
  onConfirm: (config: ScreenQualityConfig, includeAudio: boolean) => void;
  onLiveUpdate?: (config: ScreenQualityConfig) => void;
  onClose: () => void;
};

export default function ScreenQualityModal({
  open,
  isLive = false,
  onConfirm,
  onLiveUpdate,
  onClose,
}: ScreenQualityModalProps) {
  const [config, setConfig] = useState<ScreenQualityConfig>(() => loadSavedConfig().config);
  const audioUnsupported = isDesktop() && getDesktopPlatform() !== 'win32';
  const [includeAudio, setIncludeAudio] = useState<boolean>(() => {
    if (audioUnsupported) return false;
    return loadSavedConfig().includeAudio;
  });

  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  // При изменении настроек в лайв-режиме сразу вызываем onLiveUpdate
  const updateConfig = (updater: (prev: ScreenQualityConfig) => ScreenQualityConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      saveConfig(next, includeAudio);
      if (isLive && onLiveUpdate) {
        onLiveUpdate(next);
      }
      return next;
    });
  };

  const handleAudioToggle = (val: boolean) => {
    setIncludeAudio(val);
    saveConfig(config, val);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="screen-quality"
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          variants={overlayV}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            className="bg-bg-1 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            variants={panelV}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Заголовок */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-accent/20 border border-accent/30 text-accent flex items-center justify-center">
                  <Monitor size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {isLive ? 'Качество стрима (на лету)' : 'Параметры демонстрации'}
                  </h2>
                  <div className="text-xs text-slate-400">
                    {isLive ? 'Изменения применяются в реальном времени' : 'Настройте разрешение, FPS и битрейт'}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="interactive-scale p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                title="Закрыть"
              >
                <X size={18} />
              </button>
            </div>

            {/* Тело модалки с прокруткой */}
            <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-sm text-slate-200">
              {/* Блок 1: Разрешение */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Разрешение экрана
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {RESOLUTIONS.map((r) => {
                    const active = config.resolution === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => updateConfig((c) => ({ ...c, resolution: r.id }))}
                        className={`interactive-scale text-left rounded-xl p-2.5 border transition-all ${
                          active
                            ? 'border-accent bg-accent/15 text-white ring-1 ring-accent'
                            : 'border-white/10 bg-bg-2/70 hover:bg-bg-2 text-slate-300'
                        }`}
                      >
                        <div className="font-medium text-xs truncate">{r.label}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">{r.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Блок 2: FPS */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Частота кадров (FPS)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {FPS_OPTIONS.map((fps) => {
                    const active = config.frameRate === fps;
                    return (
                      <button
                        key={fps}
                        type="button"
                        onClick={() => updateConfig((c) => ({ ...c, frameRate: fps }))}
                        className={`interactive-scale py-2 text-center rounded-xl border font-mono font-medium text-xs transition-all ${
                          active
                            ? 'border-accent bg-accent/20 text-white ring-1 ring-accent'
                            : 'border-white/10 bg-bg-2/70 hover:bg-bg-2 text-slate-300'
                        }`}
                      >
                        {fps} FPS
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Блок 3: Битрейт со слайдером */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Битрейт видео
                  </label>
                  <span className="text-xs font-mono font-semibold text-accent px-2 py-0.5 rounded-lg bg-accent/15 border border-accent/30">
                    {config.bitrateMbps} Мбит/с
                  </span>
                </div>

                <div className="space-y-2">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={config.bitrateMbps}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      updateConfig((c) => ({ ...c, bitrateMbps: val }));
                    }}
                    className="w-full accent-accent cursor-pointer h-2 bg-slate-800 rounded-lg"
                  />
                  <div className="flex justify-between text-[11px] text-slate-400 px-0.5">
                    <span>1 Мбит/с</span>
                    <span>25 Мбит/с</span>
                    <span>50 Мбит/с</span>
                  </div>

                  {/* Быстрые кнопки битрейта */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {BITRATE_PRESETS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => updateConfig((c) => ({ ...c, bitrateMbps: b }))}
                        className={`interactive-scale px-2 py-1 rounded-lg text-xs font-mono border transition-colors ${
                          config.bitrateMbps === b
                            ? 'bg-accent/20 border-accent text-accent-light'
                            : 'bg-bg-2/60 border-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        {b} Мбит
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Блок 4: Передача системного звука (только если не в live) */}
              {!isLive && (
                <div className="pt-3 border-t border-white/10">
                  <label
                    className={`flex items-center gap-3 select-none ${
                      audioUnsupported ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                    }`}
                  >
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={includeAudio}
                        disabled={audioUnsupported}
                        onChange={(e) => handleAudioToggle(e.target.checked)}
                        className="sr-only"
                      />
                      <div
                        className={`w-11 h-6 rounded-full transition-colors ${
                          includeAudio ? 'bg-accent' : 'bg-bg-3 border border-white/10'
                        }`}
                      >
                        <div
                          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                            includeAudio ? 'left-6' : 'left-1'
                          }`}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        <Volume2 size={15} className="text-accent" />
                        <span>Включить системный звук экрана</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {audioUnsupported
                          ? `Системный звук недоступен на ${getDesktopPlatform() === 'darwin' ? 'macOS' : 'Linux'}`
                          : 'Передавать звук игр, видео и музыки в звонок'}
                      </div>
                    </div>
                  </label>

                  {includeAudio && (
                    <div className="mt-3 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200/90">
                      <Info size={14} className="shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        Чтобы передать звук только одной игры/вкладки — в окне выбора источника выберите вкладку («Chrome Tab») и включите «Поделиться звуком».
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Подвал */}
            <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-white/10 bg-white/[0.02]">
              <button
                type="button"
                onClick={onClose}
                className="interactive-scale px-4 py-2 rounded-xl hover:bg-white/10 text-slate-300 text-sm font-medium transition-colors"
              >
                {isLive ? 'Закрыть' : 'Отмена'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm(config, includeAudio);
                  onClose();
                }}
                className="interactive-scale px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-lg shadow-accent/20 transition-all flex items-center gap-1.5"
              >
                <Check size={16} />
                <span>{isLive ? 'Применить' : 'Начать демонстрацию'}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
