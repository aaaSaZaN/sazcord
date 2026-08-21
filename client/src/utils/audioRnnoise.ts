// AI-шумодав на базе RNNoise (рекуррентная нейросеть от Mozilla/Xiph,
// обученная на ~44 ч речи + бытовые шумы). Работает как AudioWorkletNode,
// внутри — WASM-модуль ~150 КБ. Используем готовую обвязку
// @sapphi-red/web-noise-suppressor, которая упаковывает оригинальный
// shiguredo/rnnoise-wasm в удобный класс.
//
// Архитектурные решения, которые тут зашиты:
//
//  1) WASM-блоб грузим ОДИН раз на всё приложение (cached promise).
//     Запуск нескольких звонков подряд → один сетевой запрос. Если
//     загрузка падает (offline), возвращаем null и пайплайн молча
//     fallback'ается на обычную цепочку без AI.
//
//  2) Worklet-модуль (`addModule`) регистрируется ОДИН раз НА КАЖДЫЙ
//     AudioContext: спецификация AudioWorklet требует именно так,
//     register'ы привязаны к контексту. Кэш по контексту (WeakMap),
//     чтобы повторные звонки в том же контексте не дёргали addModule
//     повторно (он, впрочем, идемпотентен — но лишний await ни к чему).
//
//  3) RNNoise работает только на 48 kHz. AudioContext в createMicPipeline
//     создаётся с явным sampleRate=48000, когда AI включён. Если браузер
//     не сможет — кинет исключение, пайплайн поймает и пойдёт без AI.
//
//  4) Динамический import() самого пакета: WASM-зависимость не должна
//     попадать в основной бандл. Vite сделает отдельный chunk.
//     URL-импорты `?url` идут статически — это просто строки, дёшево.

import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';

// Тип возвращаемого узла. Не импортируем класс из пакета сюда напрямую,
// чтобы не тащить его в главный бандл — оставляем структурный тип.
export type RnnoiseNode = AudioNode & {
  destroy: () => void;
};

// Кэш WASM-блоба (загружаем один раз). Promise разделяется между
// параллельными вызовами (Promise.all-friendly).
let cachedWasm: Promise<ArrayBuffer | null> | null = null;

// Кэш регистрации worklet-модуля по AudioContext'ам. WeakMap, чтобы
// не держать контексты после их close().
const workletRegistered = new WeakMap<AudioContext, Promise<boolean>>();

/**
 * Загрузить и закэшировать WASM-блоб. Возвращает null, если что-то
 * пошло не так (отсутствует Worklet, нет fetch, falsy SIMD detect и т.п.) —
 * вызывающий код должен этот null проверить и обойтись без AI.
 */
export function ensureRnnoiseWasm(): Promise<ArrayBuffer | null> {
  if (!cachedWasm) {
    cachedWasm = (async () => {
      try {
        // Проверяем минимальную поддержку — без AudioWorklet смысла нет.
        if (typeof AudioWorkletNode === 'undefined') return null;
        const mod = await import('@sapphi-red/web-noise-suppressor');
        // simdUrl ОБЯЗАТЕЛЕН в API loadRnnoise: внутри пакет сам делает
        // wasm-feature-detect и выбирает, какой бинарь подгрузить.
        return await mod.loadRnnoise({
          url: rnnoiseWasmUrl,
          simdUrl: rnnoiseSimdWasmUrl,
        });
      } catch (e) {
        console.warn('RNNoise WASM load failed:', e);
        return null;
      }
    })();
  }
  return cachedWasm;
}

/**
 * Регистрация AudioWorklet-модуля для конкретного AudioContext.
 * Идемпотентна по контексту: повторный вызов отдаст тот же promise.
 */
function ensureWorkletRegistered(ctx: AudioContext): Promise<boolean> {
  let p = workletRegistered.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
        return true;
      } catch (e) {
        console.warn('RNNoise worklet registration failed:', e);
        return false;
      }
    })();
    workletRegistered.set(ctx, p);
  }
  return p;
}

/**
 * Создать RnnoiseWorkletNode для указанного контекста. Возвращает null,
 * если RNNoise недоступен (fallback на обычную цепочку).
 *
 * Важно: контекст ДОЛЖЕН работать на 48 kHz — это требование RNNoise.
 * Если sampleRate не 48000, возвращаем null (создавать узел всё равно
 * можно, но качество будет плохим из-за неверной частоты дискретизации).
 */
export async function createRnnoiseNode(ctx: AudioContext): Promise<RnnoiseNode | null> {
  if (ctx.sampleRate !== 48000) {
    console.warn('RNNoise requires sampleRate=48000, got', ctx.sampleRate);
    return null;
  }
  const wasm = await ensureRnnoiseWasm();
  if (!wasm) return null;
  const ok = await ensureWorkletRegistered(ctx);
  if (!ok) return null;
  try {
    const mod = await import('@sapphi-red/web-noise-suppressor');
    const node = new mod.RnnoiseWorkletNode(ctx, {
      wasmBinary: wasm,
      // maxChannels=1 достаточно: микрофонный путь моно. Если позже
      // прилетит стерео-источник, AudioWorklet просто проиграет первый
      // канал (а у нас всё равно один — getUserMedia({audio:true})).
      maxChannels: 1,
    });
    return node as unknown as RnnoiseNode;
  } catch (e) {
    console.warn('Failed to construct RnnoiseWorkletNode:', e);
    return null;
  }
}
