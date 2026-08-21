import '@testing-library/jest-dom/vitest';

// Node 22+ отдаёт собственный экспериментальный глобал `localStorage`, который
// без флага --localstorage-file равен undefined и ПЕРЕКРЫВАЕТ реализацию из
// jsdom. Из-за этого тесты, дергающие localStorage напрямую, падали на
// "Cannot read properties of undefined (reading 'clear')". Подкладываем
// простую in-memory реализацию Storage, если глобала нет.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const existing = (globalThis as any)[name];
  if (existing && typeof existing.clear === 'function') continue;
  const storage = makeMemoryStorage();
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== 'undefined' && window !== (globalThis as any)) {
    Object.defineProperty(window, name, {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}
