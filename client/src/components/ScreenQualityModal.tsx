import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, Monitor, Info } from 'lucide-react';
import { SCREEN_PRESETS, SCREEN_PRESET_KEYS } from '../utils/media';
import { getDesktopPlatform, isDesktop } from '../utils/desktop';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';

// Модалка выбора качества демонстрации экрана. Открывается по клику на
// кнопку «Демонстрация», после подтверждения вызывает onConfirm(presetKey, includeAudio)
// и сразу закрывается — потом уже срабатывает системный диалог браузера
// для выбора окна/экрана.
export default function ScreenQualityModal({ open, defaultPreset = '720p', onConfirm, onClose }) {
  const [preset, setPreset] = useState(defaultPreset);
  // Системный звук в Electron доступен только на Windows (audio:'loopback').
  // На Linux запрос звука раньше ронял весь getDisplayMedia — демонстрация
  // просто не запускалась. На macOS OS не даёт loopback. В обоих случаях
  // тумблер выключен, чтобы не обещать несуществующее.
  const audioUnsupported = isDesktop() && getDesktopPlatform() !== 'win32';
  const [includeAudioRaw, setIncludeAudio] = useState(false);
  const includeAudio = audioUnsupported ? false : includeAudioRaw;
  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="screen-quality"
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          variants={overlayV}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            className="bg-bg-1 border border-border rounded-2xl w-full max-w-md shadow-xl"
            variants={panelV}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Monitor size={18} className="text-accent" />
                <h2 className="text-base font-semibold">Качество демонстрации</h2>
              </div>
              <button onClick={onClose} className="btn-icon hover:bg-bg-2" title="Закрыть">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-2">
              <p className="text-sm text-text-2 mb-3">
                Выберите разрешение и битрейт. Чем выше — тем чётче картинка, но и нагрузка на канал
                больше.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {SCREEN_PRESET_KEYS.map((key) => {
                  const p = SCREEN_PRESETS[key];
                  const active = preset === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setPreset(key)}
                      className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                        active
                          ? 'border-accent bg-accent/10'
                          : 'border-border bg-bg-2 hover:bg-bg-3'
                      }`}
                    >
                      <div className="font-medium text-sm">{p.label}</div>
                      <div className="text-xs text-text-2 mt-0.5">
                        до {Math.round(p.maxBitrate / 1_000_000)} Мбит/с
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <label
                  className={`flex items-center gap-3 ${
                    audioUnsupported ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                  }`}
                >
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={includeAudio}
                      disabled={audioUnsupported}
                      onChange={(e) => setIncludeAudio(e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-11 h-6 rounded-full transition-colors ${
                        includeAudio ? 'bg-accent' : 'bg-bg-3'
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
                    <div className="text-sm font-medium">Включить звук экрана</div>
                    <div className="text-xs text-text-2">
                      {audioUnsupported
                        ? `Системный звук недоступен в десктоп-версии на ${
                            getDesktopPlatform() === 'darwin' ? 'macOS' : 'Linux'
                          }`
                        : 'Передавать системный звук (музыка, видео, игры)'}
                    </div>
                  </div>
                </label>
                {includeAudio && (
                  <div className="mt-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/90">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div>
                        <strong className="text-amber-100">
                          Чтобы передать звук только одного приложения
                        </strong>{' '}
                        — в системном окне выбора выберите вкладку браузера («<em>Chrome Tab</em>» /
                        «<em>Вкладка</em>») и поставьте галочку «<em>Поделиться звуком вкладки</em>
                        ».
                      </div>
                      <div>
                        При выборе «Окно» или «Весь экран» Windows/Chrome отдают общий микшер — то
                        есть звук <em>всех</em> приложений сразу (другой браузер на этом же ПК тоже
                        попадёт в стрим). Это ограничение ОС, а не приложения.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-bg-2 text-sm">
                Отмена
              </button>
              <button
                onClick={() => {
                  onConfirm(preset, includeAudio);
                }}
                className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium"
              >
                Продолжить
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
