// ESLint flat config (ESLint 9+).
//
// Зачем такой конфиг:
//   - Один корневой конфиг для всех воркспейсов (server, client, desktop)
//     вместо трёх .eslintrc — меньше дублирования.
//   - Прагматичные правила: ловим РЕАЛЬНЫЕ баги (no-unused-vars,
//     react-hooks/exhaustive-deps), не дрочимся со стилевыми мелочами
//     (это делает Prettier через `npm run format`).
//   - Игнорим что не наше: dist/, node_modules/, public/sw.js
//     (service worker'ы генерируются и линтятся отдельно).
//
// Запуск:
//   npm run lint       — все воркспейсы, проверка
//   npm run lint:fix   — авто-исправление того что можно
//   npm run format     — Prettier по всему репо

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
  // 1) Глобальные ignore-паттерны
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.vite/**',
      '**/*.min.js',
      'client/public/sw.js', // генерируется/деплоится отдельно
      'desktop/dist/**',
      'desktop/assets/**',
    ],
  },

  // 2) Базовые JS/TS правила для всех файлов
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3) JS-файлы (server, desktop, скрипты)
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Отключаем TS-версию для JS-файлов — она не должна работать
      // на чистых JS (typescript-eslint/recommended включает её
      // глобально, но без typecheck'а на JS она даёт ложные ошибки).
      '@typescript-eslint/no-unused-vars': 'off',
      // require() разрешён в main/preload/scripts десктопа — Electron
      // main-process работает через CommonJS, ESM там пока несовместим
      // с нативными модулями (better-sqlite3, sharp).
      '@typescript-eslint/no-require-imports': 'off',
      'no-unused-vars': [
        'warn',
        {
          // _ префикс = сознательно неиспользуемый параметр (часто
          // в express middleware: function (err, _req, res, _next)).
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off', // server'у нужно console.log, в клиенте бывает дебаг
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // 4) TS-файлы (client + общие)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // any иногда оправдан (event-payload без схемы из socket.io,
      // window.electronAPI), но в основном — лень. Делаем warning,
      // не error — чтобы CI не падал, но в IDE подсвечивалось.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // _next, _e в обработчиках — норма.
      'no-unused-vars': 'off', // off здесь, чтобы не дублировать с TS-версией
      '@typescript-eslint/no-empty-object-type': 'off',
      // Многие компоненты используют ts-unaware patterns (process из node
      // в клиенте при использовании isDesktop()). Разрешаем.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // 5) React-правила для .tsx И .ts (хуки часто лежат в .ts: useCall.ts и т.п.)
  {
    files: ['client/**/*.tsx', 'client/**/*.jsx', 'client/**/*.ts'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      'react/jsx-uses-react': 'off', // React 17+ JSX transform не требует import
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off', // У нас TS
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // jsx-key важен — без него проседает hot-reload на списках.
      'react/jsx-key': 'error',
      // Часть наших компонентов принимает children как пропс без явной
      // типизации — TS это переваривает, не нужно ругаться.
      'react/no-children-prop': 'off',
      // Самозакрывающиеся теги для пустых div'ов и т.п. — слишком душно.
      'react/self-closing-comp': 'off',
    },
  },

  // 6) Тестовые файлы — мягче
  {
    files: ['**/test/**/*.js', '**/test/**/*.ts', '**/test/**/*.tsx', '**/*.test.{js,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        // vitest globals (describe/it/expect) есть и так из tsconfig types,
        // но eslint не видит их без plugin'а. Добавим вручную.
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // 7) Service worker (отдельный globals — нет window)
  {
    files: ['**/sw.js', '**/service-worker.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },

  // 8) Конфиги Vite/Tailwind/PostCSS — просто node-окружение
  {
    files: [
      '**/vite.config.*',
      '**/vitest.config.*',
      '**/tailwind.config.*',
      '**/postcss.config.*',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ВАЖНО: prettier-config'и должны идти ПОСЛЕДНИМИ — они отключают
  // правила ESLint, которые конфликтуют с форматированием Prettier'а.
  prettierConfig,
];
