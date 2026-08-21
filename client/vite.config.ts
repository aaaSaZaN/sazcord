import { readFileSync } from 'node:fs';
import { createLogger } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Версия, с которой собран этот бандл. Нужна веб-клиенту и PWA, чтобы
// сравнить себя с тем, что сейчас раздаёт сервер (GET /api/version), и
// показать плашку «доступно обновление, перезагрузи страницу». Своего
// апдейтера у них нет, а Service Worker намеренно ничего не кеширует —
// то есть достаточно одной перезагрузки.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  .version as string;

// Vite сам логирует «[vite] ws proxy socket error: Error: write ECONNABORTED»
// через `config.logger.error` ВНЕ зависимости от наших обработчиков на
// proxy. Это нормальный шум — Socket.IO у нас запускает свои WS-апгрейды,
// которые периодически штатно abort-ятся при reconnect-е клиента, а vite
// рендерит длинный stacktrace на каждый такой случай. Чистим через
// customLogger: фильтруем именно эту строку, остальные сообщения проксим.
const baseLogger = createLogger();
const origError = baseLogger.error.bind(baseLogger);
baseLogger.error = (msg, opts) => {
  if (
    typeof msg === 'string' &&
    /ws proxy socket error/i.test(msg) &&
    /(ECONNABORTED|ECONNRESET|EPIPE)/.test(msg)
  ) {
    return;
  }
  origError(msg, opts);
};

export default defineConfig({
  customLogger: baseLogger,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
  },
});
