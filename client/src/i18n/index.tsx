// Локализация интерфейса.
//
// Своя минимальная реализация вместо i18next: словарь плоский, склонений
// нет нигде, кроме уже написанных вручную мест, а тянуть 40 КБ рантайма
// ради `t()` и одного переключателя языка незачем.
//
// Ключ — строка вида 'login.title'. Отсутствующий ключ возвращает сам
// себя: так пропущенный перевод виден на экране, а не превращается в
// пустоту.
//
// Язык берётся из localStorage, а при первом запуске — из языка браузера:
// русский для ru-*, английский для всего остального. Сервер про язык
// клиента не знает и знать не должен.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ru } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';

const DICTS: Record<Lang, Record<string, string>> = { ru, en };
const STORAGE_KEY = 'sazcord.lang';

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* приватный режим браузера — просто определим по navigator */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

type Vars = Record<string, string | number>;

// Подстановка вида «{count}»: единственное, что нужно словарю. Более
// сложное форматирование (множественные числа) в переводимых строках не
// встречается — там, где оно нужно, текст собирается кодом.
function interpolate(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Vars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    // lang на <html> нужен не только скринридерам: без него браузер
    // переносит слова по правилам своего языка интерфейса.
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* не сохранилось — переживём до конца сессии */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => {
      // Русский — язык оригинала, английский словарь может отставать;
      // поэтому фолбэк на ru, а не на пустую строку.
      const dict = DICTS[lang] || ru;
      const value = dict[key] ?? ru[key] ?? key;
      return interpolate(value, vars);
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

// Отдельный хук ради самого частого случая: компоненту нужен только `t`.
export function useT() {
  return useI18n().t;
}
