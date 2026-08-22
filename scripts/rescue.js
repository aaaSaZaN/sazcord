#!/usr/bin/env node

/**
 * Sazcord Rescue CLI
 * Emergency management, user/admin control, database reset, and .env configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Поиск .env файла
function findEnvPath() {
  const candidates = [
    path.join(ROOT_DIR, 'server', '.env'),
    path.join(ROOT_DIR, '.env'),
    path.join(process.cwd(), 'server', '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(ROOT_DIR, 'server', '.env');
}

const ENV_PATH = findEnvPath();

// Чтение и парсинг .env
function loadEnvMap() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const content = fs.readFileSync(ENV_PATH, 'utf-8');
  const map = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

function updateEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  const lines = content.split('\n');
  let found = false;
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    newLines.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_PATH, newLines.join('\n'), 'utf-8');
  process.env[key] = String(value);
}

function removeEnvKey(key) {
  if (!fs.existsSync(ENV_PATH)) return;
  const content = fs.readFileSync(ENV_PATH, 'utf-8');
  const lines = content.split('\n').filter((l) => !l.trim().startsWith(`${key}=`));
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
  delete process.env[key];
}

// Подключение к БД
function findDbPath() {
  const env = loadEnvMap();
  if (process.env.SAZCORD_DB_FILE) return process.env.SAZCORD_DB_FILE;
  if (env.SAZCORD_DB_FILE) return path.resolve(ROOT_DIR, 'server', env.SAZCORD_DB_FILE);
  const candidates = [
    path.join(ROOT_DIR, 'server', 'data', 'sazcord.sqlite'),
    path.join(ROOT_DIR, 'data', 'sazcord.sqlite'),
    path.join(process.cwd(), 'server', 'data', 'sazcord.sqlite'),
    path.join(process.cwd(), 'data', 'sazcord.sqlite'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const defaultPath = path.join(ROOT_DIR, 'server', 'data', 'sazcord.sqlite');
  fs.mkdirSync(path.dirname(defaultPath), { recursive: true });
  return defaultPath;
}

function getDb() {
  const dbPath = findDbPath();
  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec('PRAGMA journal_mode = WAL;');
  rawDb.exec('PRAGMA foreign_keys = ON;');

  const db = {
    exec(sql) {
      return rawDb.exec(sql);
    },
    prepare(sql) {
      const stmt = rawDb.prepare(sql);
      return {
        get(...params) {
          return stmt.get(...params);
        },
        all(...params) {
          return stmt.all(...params);
        },
        run(...params) {
          const res = stmt.run(...params);
          return {
            lastInsertRowid: res?.lastInsertRowid,
            changes: res?.changes,
          };
        },
      };
    },
  };

  // Гарантируем наличие is_admin колонки
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all();
    if (cols.length > 0 && !cols.some((c) => c.name === 'is_admin')) {
      db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
    }
  } catch {
    /* table may not exist yet */
  }
  return { db, dbPath };
}

// Консольный UI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

function printBanner() {
  console.log(`
\x1b[36m┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m
\x1b[36m┃\x1b[0m   \x1b[1;35m⚡ SAZCORD RESCUE CLI\x1b[0m                                     \x1b[36m┃\x1b[0m
\x1b[36m┃\x1b[0m   \x1b[90mИнструмент администрирования, спасения и настройки\x1b[0m        \x1b[36m┃\x1b[0m
\x1b[36m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m
`);
}

// --- Команды ---

async function listUsers() {
  const { db } = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, username, display_name, is_admin, deleted_at, datetime(created_at/1000, 'unixepoch', 'localtime') as created
         FROM users ORDER BY id ASC`,
      )
      .all();
    if (rows.length === 0) {
      console.log('\x1b[33mВ базе данных нет пользователей.\x1b[0m');
      return;
    }
    console.log('\n\x1b[1mСписок пользователей:\x1b[0m');
    console.log('ID  | Username            | Display Name        | Admin | Status   | Created');
    console.log('----+---------------------+---------------------+-------+----------+-------------------');
    for (const r of rows) {
      const id = String(r.id).padEnd(3);
      const un = String(r.username || '').padEnd(19);
      const dn = String(r.display_name || '-').padEnd(19);
      const adm = r.is_admin === 1 ? '\x1b[32m  YES\x1b[0m' : '\x1b[90m   NO\x1b[0m';
      const status = r.deleted_at ? '\x1b[31mDELETED \x1b[0m' : '\x1b[32mACTIVE  \x1b[0m';
      console.log(`${id} | ${un} | ${dn} | ${adm} | ${status} | ${r.created || '-'}`);
    }
    console.log();
  } catch (e) {
    console.error('\x1b[31mОшибка чтения базы:\x1b[0m', e.message);
  }
}

async function listAdmins() {
  const { db } = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, username, display_name, datetime(created_at/1000, 'unixepoch', 'localtime') as created
         FROM users WHERE is_admin = 1 AND deleted_at IS NULL ORDER BY id ASC`,
      )
      .all();
    const env = loadEnvMap();
    const envAdmins = env.ADMIN_USERNAMES ? env.ADMIN_USERNAMES.split(',').map((s) => s.trim()) : [];

    console.log('\n\x1b[1m👑 Текущие администраторы:\x1b[0m');
    if (rows.length === 0 && envAdmins.length === 0) {
      console.log('\x1b[33m  (Администраторы не назначены)\x1b[0m');
    } else {
      for (const r of rows) {
        console.log(`  • [DB] \x1b[32m@${r.username}\x1b[0m (ID: ${r.id}, Имя: ${r.display_name || r.username})`);
      }
      for (const un of envAdmins) {
        if (!rows.some((r) => r.username.toLowerCase() === un.toLowerCase())) {
          console.log(`  • [ENV] \x1b[36m@${un}\x1b[0m (через ADMIN_USERNAMES)`);
        }
      }
    }
    console.log();
  } catch (e) {
    console.error('\x1b[31mОшибка чтения базы:\x1b[0m', e.message);
  }
}

async function makeAdmin(username) {
  if (!username) {
    username = await ask('Введите username пользователя: ');
  }
  username = username.trim();
  if (!username) return;

  const { db } = getDb();
  const row = db
    .prepare('SELECT id, username, is_admin FROM users WHERE username = ?')
    .get(username);
  if (!row) {
    console.log(`\x1b[31mПользователь "${username}" не найден.\x1b[0m`);
    return;
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(row.id);
  console.log(`\x1b[32m✓ Пользователь @${row.username} (ID: ${row.id}) теперь администратор!\x1b[0m`);
}

async function revokeAdmin(username) {
  if (!username) {
    username = await ask('Введите username пользователя для снятия прав: ');
  }
  username = username.trim();
  if (!username) return;

  const { db } = getDb();
  const row = db
    .prepare('SELECT id, username, is_admin FROM users WHERE username = ?')
    .get(username);
  if (!row) {
    console.log(`\x1b[31mПользователь "${username}" не найден.\x1b[0m`);
    return;
  }
  db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(row.id);
  console.log(`\x1b[32m✓ Права администратора у @${row.username} успешно сняты.\x1b[0m`);
}

async function resetAllAdmins() {
  const confirm = await ask(
    '\x1b[33mВы уверены, что хотите снять права администратора со ВСЕХ пользователей в БД? (y/N): \x1b[0m',
  );
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log('Отменено.');
    return;
  }
  const { db } = getDb();
  const res = db.prepare('UPDATE users SET is_admin = 0').run();
  console.log(`\x1b[32m✓ Сняты права у всех пользователей (затронуто строк: ${res.changes}).\x1b[0m`);
}

async function resetUserPassword(username, newPass) {
  if (!username) {
    username = await ask('Введите username пользователя: ');
  }
  username = username.trim();
  if (!username) return;

  if (!newPass) {
    newPass = await ask('Введите новый пароль (мин. 6 символов): ');
  }
  newPass = newPass.trim();
  if (newPass.length < 6) {
    console.log('\x1b[31mПароль должен быть не менее 6 символов!\x1b[0m');
    return;
  }

  const { db } = getDb();
  const row = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!row) {
    console.log(`\x1b[31mПользователь "${username}" не найден.\x1b[0m`);
    return;
  }

  const hash = await bcrypt.hash(newPass, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, row.id);
  console.log(`\x1b[32m✓ Пароль для @${row.username} успешно изменён!\x1b[0m`);
}

async function configureRegistration() {
  const env = loadEnvMap();
  console.log('\n\x1b[1mТекущий статус регистрации:\x1b[0m');
  console.log(`  REGISTRATION_DISABLED = ${env.REGISTRATION_DISABLED || '0'}`);
  console.log(`  REGISTRATION_OPEN     = ${env.REGISTRATION_OPEN || '1 (открыта по умолчанию)'}`);
  console.log(`  REGISTRATION_CODE     = ${env.REGISTRATION_CODE || '(не задан)'}`);
  console.log(`  REGISTRATION_INVITE_ONLY = ${env.REGISTRATION_INVITE_ONLY || '0'}`);

  console.log('\nВыберите действие:');
  console.log('  1) Открыть свободную регистрацию для всех (без кодов)');
  console.log('  2) Закрыть регистрацию полностью');
  console.log('  3) Задать общий секретный код регистрации');
  console.log('  4) Сделать регистрацию только по персональным инвайтам');
  console.log('  0) Назад');

  const choice = (await ask('\nВаш выбор: ')).trim();
  if (choice === '1') {
    updateEnvKey('REGISTRATION_DISABLED', '0');
    updateEnvKey('REGISTRATION_OPEN', '1');
    removeEnvKey('REGISTRATION_CODE');
    removeEnvKey('REGISTRATION_INVITE_ONLY');
    console.log('\x1b[32m✓ Регистрация открыта для всех.\x1b[0m');
  } else if (choice === '2') {
    updateEnvKey('REGISTRATION_DISABLED', '1');
    console.log('\x1b[32m✓ Регистрация полностью закрыта.\x1b[0m');
  } else if (choice === '3') {
    const code = (await ask('Введите новый регистрационный код: ')).trim();
    if (code) {
      updateEnvKey('REGISTRATION_DISABLED', '0');
      updateEnvKey('REGISTRATION_CODE', code);
      console.log(`\x1b[32m✓ Регистрационный код установлен: "${code}"\x1b[0m`);
    }
  } else if (choice === '4') {
    updateEnvKey('REGISTRATION_DISABLED', '0');
    updateEnvKey('REGISTRATION_OPEN', '0');
    updateEnvKey('REGISTRATION_INVITE_ONLY', '1');
    removeEnvKey('REGISTRATION_CODE');
    console.log('\x1b[32m✓ Регистрация переведена в режим "только по инвайт-ссылкам".\x1b[0m');
  }
}

async function configureSocialMode() {
  const env = loadEnvMap();
  const cur = env.SAZCORD_SOCIAL_MODE || 'local';
  console.log(`\nТекущий режим видимости: \x1b[1;36m${cur}\x1b[0m`);
  console.log('  • local   — Все пользователи видят друг друга сразу (для компании/сервера)');
  console.log('  • private — Пользователи видят только друзей и участников общих групп (как Discord/TG)');
  console.log('\nВыберите новый режим:');
  console.log('  1) local');
  console.log('  2) private');
  console.log('  0) Назад');

  const choice = (await ask('\nВаш выбор: ')).trim();
  if (choice === '1') {
    updateEnvKey('SAZCORD_SOCIAL_MODE', 'local');
    console.log('\x1b[32m✓ Установлен режим "local". Перезапустите Sazcord.\x1b[0m');
  } else if (choice === '2') {
    updateEnvKey('SAZCORD_SOCIAL_MODE', 'private');
    console.log('\x1b[32m✓ Установлен режим "private". Перезапустите Sazcord.\x1b[0m');
  }
}

async function viewEditEnv(interactive = true) {
  const env = loadEnvMap();
  console.log(`\n\x1b[1mКонфигурация .env (${ENV_PATH}):\x1b[0m`);
  const keys = Object.keys(env);
  if (keys.length === 0) {
    console.log('  (Файл .env пуст или не содержит переменных)');
  } else {
    for (const [k, v] of Object.entries(env)) {
      console.log(`  \x1b[36m${k.padEnd(26)}\x1b[0m = \x1b[32m${v}\x1b[0m`);
    }
  }
  if (!interactive) return;
  console.log('\n1) Изменить / Добавить переменную');
  console.log('2) Удалить переменную');
  console.log('0) Назад');
  const choice = (await ask('\nВаш выбор: ')).trim();
  if (choice === '1') {
    const key = (await ask('Имя переменной (напр. PORT): ')).trim();
    if (key) {
      const val = (await ask(`Значение для ${key}: `)).trim();
      updateEnvKey(key, val);
      console.log(`\x1b[32m✓ ${key}=${val} сохранено в .env\x1b[0m`);
    }
  } else if (choice === '2') {
    const key = (await ask('Имя переменной для удаления: ')).trim();
    if (key) {
      removeEnvKey(key);
      console.log(`\x1b[32m✓ ${key} удалено из .env\x1b[0m`);
    }
  }
}

async function wipeDatabase() {
  const { dbPath } = getDb();
  console.log(`\n\x1b[1;31m⚠️  ВНИМАНИЕ: СБРОС БАЗЫ ДАННЫХ\x1b[0m`);
  console.log(`Файл базы: ${dbPath}`);
  console.log('Это действие удалит всех пользователей, сообщения, группы и файлы БД безвозвратно!\n');

  const answer = await ask('Введите слово "RESET" заглавными буквами для подтверждения: ');
  if (answer !== 'RESET') {
    console.log('Сброс отменён.');
    return;
  }

  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
    if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    console.log('\x1b[32m✓ База данных успешно сброшена (удалена). При следующем старте Sazcord создаст чистую базу.\x1b[0m');
  } catch (e) {
    console.error('\x1b[31mОшибка удаления файлов БД:\x1b[0m', e.message);
  }
}

// Интерактивное меню
async function interactiveMenu() {
  printBanner();
  while (true) {
    console.log('\x1b[1mГлавное меню Rescue CLI:\x1b[0m');
    console.log('  1) 👑 Назначить администратора');
    console.log('  2) 🚫 Снять права администратора');
    console.log('  3) 📜 Список администраторов');
    console.log('  4) 🔄 Сбросить ВСЕХ администраторов');
    console.log('  5) 🔑 Сменить пароль пользователя');
    console.log('  6) 👥 Список всех пользователей');
    console.log('  7) 🚪 Настройки регистрации');
    console.log('  8) 🌐 Режим видимости (local / private)');
    console.log('  9) ⚙️  Просмотр и редактирование .env');
    console.log('  10) 💣 Сброс базы данных (Wipe Database)');
    console.log('  0) Выход\n');

    const choice = (await ask('Выберите действие [0-10]: ')).trim();
    if (choice === '0' || choice === 'q' || choice === 'exit') {
      console.log('Выход из Rescue CLI.');
      break;
    }
    switch (choice) {
      case '1':
        await makeAdmin();
        break;
      case '2':
        await revokeAdmin();
        break;
      case '3':
        await listAdmins();
        break;
      case '4':
        await resetAllAdmins();
        break;
      case '5':
        await resetUserPassword();
        break;
      case '6':
        await listUsers();
        break;
      case '7':
        await configureRegistration();
        break;
      case '8':
        await configureSocialMode();
        break;
      case '9':
        await viewEditEnv();
        break;
      case '10':
        await wipeDatabase();
        break;
      default:
        console.log('\x1b[33mНеверный выбор.\x1b[0m');
    }
    console.log('\n' + '─'.repeat(60) + '\n');
  }
  rl.close();
}

// CLI аргументы
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await interactiveMenu();
    return;
  }

  const cmd = args[0].toLowerCase();
  switch (cmd) {
    case 'admin:set':
    case 'make-admin':
      await makeAdmin(args[1]);
      break;
    case 'admin:remove':
    case 'revoke-admin':
      await revokeAdmin(args[1]);
      break;
    case 'admin:list':
    case 'list-admins':
      await listAdmins();
      break;
    case 'admin:reset':
    case 'reset-admins':
      await resetAllAdmins();
      break;
    case 'user:password':
    case 'reset-password':
      await resetUserPassword(args[1], args[2]);
      break;
    case 'user:list':
    case 'list-users':
      await listUsers();
      break;
    case 'reg:open':
      updateEnvKey('REGISTRATION_DISABLED', '0');
      updateEnvKey('REGISTRATION_OPEN', '1');
      removeEnvKey('REGISTRATION_CODE');
      removeEnvKey('REGISTRATION_INVITE_ONLY');
      console.log('\x1b[32m✓ Регистрация открыта для всех.\x1b[0m');
      break;
    case 'reg:close':
      updateEnvKey('REGISTRATION_DISABLED', '1');
      console.log('\x1b[32m✓ Регистрация закрыта.\x1b[0m');
      break;
    case 'reg:code':
      if (!args[1]) {
        console.error('Укажите код: reg:code <code>');
        process.exit(1);
      }
      updateEnvKey('REGISTRATION_DISABLED', '0');
      updateEnvKey('REGISTRATION_CODE', args[1]);
      console.log(`\x1b[32m✓ Регистрационный код установлен: "${args[1]}"\x1b[0m`);
      break;
    case 'mode:social':
      if (args[1] !== 'local' && args[1] !== 'private') {
        console.error('Укажите режим: mode:social local | mode:social private');
        process.exit(1);
      }
      updateEnvKey('SAZCORD_SOCIAL_MODE', args[1]);
      console.log(`\x1b[32m✓ SAZCORD_SOCIAL_MODE=${args[1]} установлен.\x1b[0m`);
      break;
    case 'env:view':
      await viewEditEnv(false);
      break;
    case 'env:set':
      if (!args[1] || args[2] === undefined) {
        console.error('Использование: env:set KEY VALUE');
        process.exit(1);
      }
      updateEnvKey(args[1], args[2]);
      console.log(`\x1b[32m✓ ${args[1]}=${args[2]} сохранено.\x1b[0m`);
      break;
    case 'db:reset':
      await wipeDatabase();
      break;
    default:
      console.log(`Неизвестная команда "${cmd}". Доступные команды:`);
      console.log('  admin:set <user>, admin:remove <user>, admin:list, admin:reset');
      console.log('  user:password <user> <new_pass>, user:list');
      console.log('  reg:open, reg:close, reg:code <code>');
      console.log('  mode:social <local|private>');
      console.log('  env:view, env:set <KEY> <VALUE>');
      console.log('  db:reset');
      process.exit(1);
  }
  rl.close();
}

main().catch((err) => {
  console.error('\x1b[31mОшибка:\x1b[0m', err);
  process.exit(1);
});
