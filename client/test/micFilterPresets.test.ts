import { describe, it, expect } from 'vitest';
import {
  applyMicFilterPreset,
  detectMicFilterPreset,
  getMicFilterPreset,
} from '../src/utils/audioProcessing';

// Дефолты SettingsContext должны 1-в-1 совпадать со «Стандарт» — это инвариант
// UI: иначе при свежей установке юзер увидит «Пользовательский» и подумает,
// что что-то сломалось. Если этот тест краснеет — синхронизируйте DEFAULTS
// в SettingsContext.tsx с STANDARD_PRESET в audioProcessing.ts.
const FRESH_DEFAULTS = {
  highPassFilter: true,
  highPassFrequency: 100,
  compressorEnabled: true,
  compressorThreshold: -24,
  compressorRatio: 4,
  compressorAttack: 5,
  compressorRelease: 50,
  compressorKnee: 30,
  noiseSuppression: true,
  noiseThreshold: -55,
  noiseGateHoldMs: 200,
  noiseGateAttackMs: 10,
  noiseGateReleaseMs: 80,
  makeupGainDb: 0,
  // RNNoise отключён в дефолтах (как и в STANDARD_PRESET) — AI-шумодав
  // тащит +150 КБ WASM, поэтому включается только в «Агрессивном».
  aiNoiseSuppression: false,
};

describe('micFilterPresets', () => {
  it('detects fresh defaults as "standard"', () => {
    expect(detectMicFilterPreset(FRESH_DEFAULTS)).toBe('standard');
  });

  it('detects empty/undefined settings as "standard" (graceful)', () => {
    expect(detectMicFilterPreset({})).toBe('standard');
    expect(detectMicFilterPreset(null)).toBe('standard');
  });

  it('detects "off" when all processing toggles are false', () => {
    const off = applyMicFilterPreset('off');
    expect(detectMicFilterPreset(off)).toBe('off');
  });

  it('detects "aggressive" payload', () => {
    const agg = applyMicFilterPreset('aggressive');
    expect(detectMicFilterPreset(agg)).toBe('aggressive');
  });

  it('"aggressive" preset enables aiNoiseSuppression (RNNoise)', () => {
    // Контракт UX-а: «Агрессивный» включает RNNoise. Если кто-то решит
    // отключить AI в этом пресете — пусть сначала прочитает обоснование
    // в audioProcessing.ts (RNNoise — главное, что отличает «агрессивный»
    // от «стандарта»; без него остаётся только чуть жёстче gate, что
    // не оправдывает отдельный пресет).
    // applyMicFilterPreset возвращает union (с fallback'ом на одиночный
    // ключ micFilterPreset); тут нам нужен полный payload — `as any`
    // устраняет узкое типизирование без жертвы рантайм-проверки.
    const agg = applyMicFilterPreset('aggressive') as any;
    expect(agg.aiNoiseSuppression).toBe(true);
    const std = applyMicFilterPreset('standard') as any;
    expect(std.aiNoiseSuppression).toBe(false);
    const off = applyMicFilterPreset('off') as any;
    expect(off.aiNoiseSuppression).toBe(false);
  });

  it('returns "custom" when even one number drifts', () => {
    // Тонкий случай: все ключи как у standard, кроме одного.
    const tweaked = { ...FRESH_DEFAULTS, compressorRatio: 5 };
    expect(detectMicFilterPreset(tweaked)).toBe('custom');
  });

  it('returns "custom" when boolean toggles disagree with any preset', () => {
    // HP off, всё остальное как standard — нет такого пресета.
    const tweaked = { ...FRESH_DEFAULTS, highPassFilter: false };
    expect(detectMicFilterPreset(tweaked)).toBe('custom');
  });

  it('applyMicFilterPreset includes the preset name itself', () => {
    const payload = applyMicFilterPreset('aggressive');
    expect(payload.micFilterPreset).toBe('aggressive');
  });

  it('getMicFilterPreset returns null for "custom"', () => {
    expect(getMicFilterPreset('custom')).toBeNull();
  });

  it('preset payloads are stable shape (regression: same keys)', () => {
    // Все три пресета должны иметь одинаковый набор ключей: иначе
    // detectMicFilterPreset будет сравнивать неполные срезы и врать.
    const off = getMicFilterPreset('off');
    const std = getMicFilterPreset('standard');
    const agg = getMicFilterPreset('aggressive');
    expect(off).not.toBeNull();
    expect(std).not.toBeNull();
    expect(agg).not.toBeNull();
    const offKeys = Object.keys(off!).sort();
    const stdKeys = Object.keys(std!).sort();
    const aggKeys = Object.keys(agg!).sort();
    expect(stdKeys).toEqual(offKeys);
    expect(aggKeys).toEqual(offKeys);
  });

  it('round-trip: choosing then detecting returns same name', () => {
    for (const name of ['off', 'standard', 'aggressive'] as const) {
      const payload = applyMicFilterPreset(name);
      expect(detectMicFilterPreset(payload)).toBe(name);
    }
  });
});
