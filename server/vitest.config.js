import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // `node:sqlite` — prefix-only builtin, Vite не умеет его резолвить и
      // валит каждый тест, который тянет src/db.js. Подробности и сам шим —
      // в test/nodeSqliteShim.js. Прод-код импортирует `node:sqlite` напрямую.
      'node:sqlite': path.resolve(dir, 'test/nodeSqliteShim.js'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    pool: 'forks',
  },
});
