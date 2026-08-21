import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Изолированный файл БД для тестов и фиктивный JWT-секрет.
// Файл создаётся уникальным, чтобы тесты не пересекались.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sazcord-test-'));
process.env.SAZCORD_DB_FILE = path.join(tmpDir, 'test.sqlite');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(tmpDir, 'uploads');

// На случай, если код проверяет NODE_ENV
process.env.NODE_ENV = 'test';

// Регистрация на сервере закрыта по умолчанию (первый аккаунт — владелец,
// дальше нужен инвайт). Тестам почти везде нужно просто заводить юзеров
// пачками, поэтому в тестовой среде открываем её явно. Сами правила
// гейтинга проверяются в auth.test.js, который эту переменную снимает.
process.env.REGISTRATION_OPEN = '1';
