// Тест-шим для `node:sqlite`.
//
// Vite/vitest снимает префикс `node:` перед проверкой на builtin, а в
// module.builtinModules этот модуль лежит ТОЛЬКО как 'node:sqlite'
// (prefix-only builtin). Из-за этого резолвер уходил искать npm-пакет
// `sqlite` и валил каждый тест, который тянет src/db.js:
//   Error: Failed to load url sqlite (resolved id: sqlite)
//
// Здесь берём модуль через createRequire (Node резолвит его сам) и
// реэкспортируем. Подключается алиасом в vitest.config.js; прод-код
// продолжает импортировать `node:sqlite` напрямую.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite');

export const { DatabaseSync, StatementSync, constants, backup } = sqlite;
export default sqlite;
