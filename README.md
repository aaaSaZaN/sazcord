# Sazcord

<div align="center">

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Node: >=22.5.0](https://img.shields.io/badge/Node-%E2%89%A522.5.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React: 18](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P-orange.svg)](https://webrtc.org/)

**Легковесный, приватный, самохостируемый мессенджер с голосовыми/видеозвонками, демонстрацией экрана и обменом файлами.**

</div>

---

## Содержание

1. [О проекте](#о-проекте)
   - [Ключевые возможности](#ключевые-возможности)
   - [Архитектура и безопасность](#архитектура-и-безопасность)
2. [Системные требования](#системные-требования)
3. [Быстрый старт (Скрипт автоустановки)](#быстрый-старт-скрипт-автоустановки)
4. [Ручная установка (Manual Installation)](#ручная-установка-пошагово)
   - [Необходимые пакеты](#1-необходимые-пакеты)
   - [Пошаговая инструкция](#2-пошаговая-инструкция-развёртывания)
5. [Конфигурация (Переменные .env)](#конфигурация-переменные-env)
6. [Клиенты (Web, PWA, Desktop, Android)](#клиенты)
7. [Разработка и тесты](#разработка-и-тестирование)
8. [Лицензия](#лицензия)

---

## О проекте

**Sazcord** - открытый self-hosted аналог Discord: вы можете поднять на своем личном сервере мессенджер без пингов, ограничений на размер файлов в сообщениях и с высоким битрейтом демонстрации экрана.

### Ключевые возможности

* **Сообщения и чаты:**
  * Личные диалоги (DM) и **групповые чаты** (до 10 человек) с аватарками и управлением ролями.
  * Форматирование текста через **Markdown**, цитирование, ответы, пересылка сообщений и реакции (эмодзи).
  * Редактирование и удаление сообщений в реальном времени.
* **Голосовые сообщения:**
  * Запись с отображением формы волны, регулятор скорости воспроизведения (1x / 1.5x / 2x).
  * Переключение устройств вывода звука (динамики/наушники).
* **WebRTC-звонки (1:1 и группы):**
  * Прямой P2P аудио/видеостриминг в реальном времени без промежуточных медиа-серверов.
  * Сетка участников при групповых созвонах.
  * **Автовосстановление связи (5 минут):** если сеть оборвалась, звонок можно продолжить нажатием одной кнопки без повторного вызова.
* **Демонстрация экрана:**
  * Шаринг всего экрана, отдельного окна или вкладки браузера.
  * Поддержка захвата системного аудио и звука конкретных приложений.
* **Встроенное AI-шумоподавление:**
  * Шумодав на базе **RNNoise (WebAssembly)**, работающий на стороне клиента без передачи сырого аудио на сторонние серверы.
* **Приватность и гибкий доступ:**
  * **2 режима видимости:** `local` (открытый список пользователей) и `private` (модель друзей и общих групп, как в Discord).
  * **Контроль регистрации:** закрытый сервер по умолчанию, поддержка разовых инвайт-ссылок, общего кода или открытой регистрации.
  * **Автоочистка истории (Retention):** автоматическое удаление старых сообщений и вложений (по умолчанию 90 дней).
* **Уведомления:**
  * Web Push уведомления для браузеров и смартфонов (звонки и сообщения доходят даже при закрытой вкладке).
  * Оповещения в Telegram о статусе сервера (`start`, `stop`, `fail`).

### Архитектура и безопасность

* **Бэкенд:** Node.js, Express, Socket.IO, JWT (HS256) + bcryptjs для паролей.
* **База данных:** Встроенный `node:sqlite` (Node.js 22.5+) с включенным WAL-режимом (никаких внешних СУБД).
* **Фронтенд:** React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, Motion.
* **Безопасность:** Защита от XSS/CSRF через Helmet, строгий Content Security Policy (CSP), защита от брутфорса через `express-rate-limit`, валидация MIME/Magic-bytes загружаемых файлов.

---

## Системные требования

### 1. Аппаратные ресурсы (Сервер / VPS)
* **Процессор (CPU):** от 1 ядра (1 vCPU).
* **Оперативная память (RAM):** 
  * **Минимум:** `512 МБ - 1 ГБ` (сам сервер Sazcord потребляет ~80-120 МБ).
  * **Рекомендуется:** `1-2 ГБ` (для комфортной сборки фронтенда и кэша).
* **Дисковое пространство:** от `5 до ∞ ГБ SSD` (Ну а что? Мы не контролируем то, сколько файлов вы зальете на сервер. Но вы сможете это контролировать :) ).

### 2. Программное окружение
* **Операционная система:** Linux (Debian 12+, Ubuntu 22.04+, Arch Linux, Alpine и др.).
* **Среда Node.js:** **`>= 22.5.0`** *(Обязательно: используется встроенный модуль `node:sqlite`)*.
* **Менеджер пакетов:** `npm >= 10.0.0`.
* **Веб-сервер / Прокси:** `Nginx` (1.20+) или `Caddy` (2.x) с поддержкой WebSocket.
* **SSL-сертификат (HTTPS):** Обязателен для работы WebRTC-звонков, микрофона, камеры и Web Push в браузерах.
  * **Если есть домен:** скрипт автоматически выпустит доверенный бесплатный сертификат Let's Encrypt через `certbot`.
  * **Если ставите по чистому IP-адресу (без домена):** Let's Encrypt не выдает сертификаты на IP-адреса, поэтому скрипт создаст самоподписанный SSL-сертификат. При первом входе браузер покажет стандартное предупреждение ("Подключение не защищено") - нужно нажать "Дополнительно" -> "Перейти на сайт". После этого звонки, микрофон и сокеты будут работать штатно. Для постоянной работы рекомендуется привязать любой бесплатный домен (например DuckDNS).
* **Сетевые порты:**
  * `80/TCP` (HTTP - редирект и выпуск SSL-сертификатов).
  * `443/TCP` (HTTPS - основной трафик, API, файлы и WebSockets). ** с большой звездочкой можно садить и на другой порт , но используйте 443 пожалуйста порт
  * `3478/UDP+TCP` и `49152-65535/UDP` *(опционально, только при использовании собственного coturn/TURN сервера для звонков через строгий NAT)*.

---

## Быстрый старт (Скрипт автоустановки)

Для быстрой установки на чистый сервер под управлением **Debian 12+** или **Ubuntu 22.04+** подготовлен скрипт [`deploy/setup.sh`](deploy/setup.sh).

### Что скрипт делает автоматически:
1. Проверяет систему и ставит необходимые системные пакеты (`nginx`, `curl`, `git`, `rsync`, `openssl`, `certbot`).
2. Устанавливает актуальный **Node.js 22 LTS**.
3. Заводит системного пользователя `sazcord` и раскладывает код в `/opt/sazcord`.
4. Собирает клиент и зависимости.
5. Генерирует надежный криптографический `JWT_SECRET` и создает файл `server/.env`.
6. Выпускает настоящий **SSL-сертификат Let's Encrypt** (или самоподписанный для IP).
7. Настраивает и запускает обратный прокси (reverse proxy) **Nginx** и службу **systemd**.

### Запуск установки:

```bash
# 1. Скачайте репозиторий
git clone https://github.com/aaaSaZaN/sazcord.git
cd sazcord

# 2. Запустите мастер установки от sudo
sudo bash deploy/setup.sh
```

---

## Ручная установка (Пошагово)

Если вы хотите развернуть проект вручную, настроить собственный стек (например, с Caddy или Docker) или детально контролировать каждый шаг - следуйте этой инструкции.

### 1. Необходимые пакеты

#### Системные пакеты (ОС Linux)
* **Node.js**: `>= 22.5.0` *(Обязательно: используется встроенный модуль `node:sqlite`)*.
* **npm**: `>= 10.0.0`
* **Git, cURL, OpenSSL, rsync, build-essential**
* **Nginx** (1.22+) или **Caddy** (2.x)
* **Certbot**

---

### 2. Пошаговая инструкция развёртывания

#### Шаг 1: Установка Node.js 22
```bash
# Добавляем репозиторий NodeSource Node 22 (пример для Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get update
sudo apt-get install -y nodejs build-essential git rsync openssl nginx certbot python3-certbot-nginx

# Проверяем версию (должна быть 22.5.0 или новее)
node -v
```

#### Шаг 2: Создание системного пользователя и каталога
```bash
# Создаём пользователя sazcord без доступа к шеллу
sudo useradd --system --home /opt/sazcord --shell /usr/sbin/nologin sazcord

# Клонируем репозиторий
sudo git clone https://github.com/aaaSaZaN/sazcord.git /opt/sazcord
cd /opt/sazcord
```

#### Шаг 3: Установка npm-зависимостей и сборка
```bash
cd /opt/sazcord

# Устанавливаем зависимости сервера и клиента
npm install --omit=dev --workspaces=false
npm --workspace server install --omit=dev
npm --workspace client install

# Собираем production-бандл фронтенда (в client/dist)
npm run build
```

#### Шаг 4: Настройка переменных окружения (`server/.env`)
```bash
# Создаём рабочий .env из примера
sudo cp server/.env.example server/.env

# Генерируем криптографический ключ для JWT
JWT_RANDOM_SECRET=$(openssl rand -hex 48)
sudo sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_RANDOM_SECRET|" server/.env

# Редактируем конфигурацию
sudo nano server/.env
```

Минимальные параметры для боевого сервера в `server/.env`:
```env
PORT=3001
HOST=127.0.0.1
NODE_ENV=production
JWT_SECRET=ваш_сгенерированный_секрет
APP_ORIGIN=https://sazcord.example.com
TRUST_PROXY=1
MAX_UPLOAD_MB=500
RETENTION_DAYS=90
```

Создаём папки для данных и выставляем права:
```bash
sudo mkdir -p /opt/sazcord/server/data /opt/sazcord/server/uploads
sudo chown -R sazcord:sazcord /opt/sazcord
sudo chmod 600 /opt/sazcord/server/.env
```

#### Шаг 5: Настройка службы systemd
```bash
# Копируем готовый unit-файл
sudo cp deploy/sazcord.service /etc/systemd/system/sazcord.service

# Применяем конфигурацию и запускаем службу
sudo systemctl daemon-reload
sudo systemctl enable --now sazcord

# Проверяем статус работы сервера
sudo systemctl status sazcord
curl http://127.0.0.1:3001/api/health
```

#### Шаг 6: Настройка Nginx с поддержкой WebSockets и SSL
Создайте конфиг `/etc/nginx/sites-available/sazcord.conf`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name sazcord.example.com;
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sazcord.example.com;

    # Пути к SSL сертификатам Let's Encrypt (после certbot)
    ssl_certificate     /etc/letsencrypt/live/sazcord.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sazcord.example.com/privkey.pem;

    client_max_body_size 500m;

    # WebSocket проксирование для Socket.IO и звонков
    location /socket.io/ {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:3001;
        proxy_buffering off;
    }

    # Загрузка и раздача файлов без буферизации
    location /uploads/ {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:3001;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Основной интерфейс и API
    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:3001;
    }
}
```

Активируем сайт и получаем сертификат:
```bash
sudo ln -sf /etc/nginx/sites-available/sazcord.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Выпускаем SSL-сертификат
sudo certbot --nginx -d sazcord.example.com

# Проверяем и перезапускаем Nginx
sudo nginx -t
sudo systemctl restart nginx
```

#### Шаг 7: Первый вход и назначение администратора
1. Откройте `https://sazcord.example.com` в браузере и зарегистрируйте свой первый аккаунт.
2. Для назначения себя администратором сервера выполните команду Rescue CLI на сервере:
   ```bash
   npm run rescue -- admin:set <ваш_username>
   ```
3. После этого в веб-интерфейсе появится доступ к разделу администратора.
4. Выдавать доступы новым пользователям можно через инвайт-ссылки в панели настроек, общий код регистрации или открыв регистрацию для всех.

---

## Rescue CLI (Управление, спасение и администрирование)

В проект встроен мощный инструмент **Rescue CLI** для управления инстансом, администраторами, сброса паролей, настройки `.env` и экстренного обслуживания базы данных.

### Запуск интерактивного меню
```bash
npm run rescue
# или
node scripts/rescue.js
```
Откроется интерактивное меню в терминале с поддержкой выбора действий:
```text
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃   ⚡ SAZCORD RESCUE CLI                                     ┃
┃   Инструмент администрирования, спасения и настройки        ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Главное меню Rescue CLI:
  1) 👑 Назначить администратора
  2) 🚫 Снять права администратора
  3) 📜 Список администраторов
  4) 🔄 Сбросить ВСЕХ администраторов
  5) 🔑 Сменить пароль пользователя
  6) 👥 Список всех пользователей
  7) 🚪 Настройки регистрации
  8) 🌐 Режим видимости (local / private)
  9) ⚙️  Просмотр и редактирование .env
  10) 💣 Сброс базы данных (Wipe Database)
  0) Выход
```

### Прямые команды (Non-interactive)
Вы можете вызывать команды Rescue CLI напрямую без интерактивного режима:

* **Назначить администратора:**
  ```bash
  npm run rescue -- admin:set <username>
  ```
* **Снять права администратора:**
  ```bash
  npm run rescue -- admin:remove <username>
  ```
* **Посмотреть список всех администраторов:**
  ```bash
  npm run rescue -- admin:list
  ```
* **Сбросить ВСЕХ администраторов:**
  ```bash
  npm run rescue -- admin:reset
  ```
* **Сменить пароль любого пользователя:**
  ```bash
  npm run rescue -- user:password <username> <new_password>
  ```
* **Список всех пользователей инстанса:**
  ```bash
  npm run rescue -- user:list
  ```
* **Управление регистрацией:**
  ```bash
  npm run rescue -- reg:open            # Открыть свободную регистрацию для всех
  npm run rescue -- reg:close           # Закрыть регистрацию
  npm run rescue -- reg:code MySecret   # Задать общий регистрационный код
  ```
* **Переключение режима видимости:**
  ```bash
  npm run rescue -- mode:social local   # Режим компании (все видят всех)
  npm run rescue -- mode:social private # Режим Discord (только друзья и соучастники групп)
  ```
* **Просмотр и изменение .env:**
  ```bash
  npm run rescue -- env:view
  npm run rescue -- env:set PORT 3001
  ```
* **Полный сброс (Wipe) базы данных:**
  ```bash
  npm run rescue -- db:reset
  ```

---

## Конфигурация (Переменные .env)

Полный список доступных переменных приведён в [`server/.env.example`](server/.env.example):

| Переменная | По умолчанию | Описание |
| :--- | :--- | :--- |
| `PORT` | `3001` | Порт, который слушает Node.js сервер. |
| `HOST` | `0.0.0.0` | Сетевой интерфейс (`127.0.0.1` для работы строго за прокси). |
| `NODE_ENV` | `development` | При `production` включает строгий CSP, CORS и проверку JWT. |
| `JWT_SECRET` | - | **Обязательный** секретный ключ подписи токенов (>=16 символов). |
| `JWT_TTL` | `never` | Время жизни сессии (`never`, `14d`, `24h`). |
| `ADMIN_USERNAMES` | - | Список логинов администраторов через запятую (альтернатива БД). |
| `APP_ORIGIN` | - | Разрешённые CORS-домены через запятую (`https://sazcord.example.com`). |
| `TRUST_PROXY` | `1` | Доверие к заголовкам `X-Forwarded-For` от Nginx/Caddy. |
| `MAX_UPLOAD_MB` | `500` | Максимальный размер одного вложения в мегабайтах. |
| `UPLOADS_MAX_TOTAL_MB` | `0` (безлимит) | Потолок дискового места под все файлы инстанса. |
| `RETENTION` | `90d` | Срок хранения сообщений и вложений (`30m`, `12h`, `90d`). |
| `SAZCORD_SOCIAL_MODE`| `local` | Режим контактов: `local` (видны все) или `private` (только друзья/группы). |
| `REGISTRATION_CODE` | - | Общий статический код для регистрации. |
| `REGISTRATION_OPEN` | `1` | `1` - регистрация открыта для всех, `0` - только по инвайтам. |
| `REGISTRATION_DISABLED`| `0` | `1` - закрыть регистрацию наглухо. |
| `STUN_URLS` | Google STUN | CSV адресов STUN серверов (`stun:stun.l.google.com:19302`). |
| `TURN_URL` / `TURN_USERNAME` / `TURN_PASSWORD` | - | Настройки coturn/TURN для звонков за строгим NAT (см. `deploy/turn/`). |

---

## Клиенты

* **Web & PWA:** Откройте сайт в Chrome / Safari / Firefox и нажмите "Установить приложение" в адресной строке для работы в виде отдельного окна с Web Push.
* **Desktop (Windows, macOS, Linux):** Нативная оболочка на базе Electron с поддержкой глобальных хоткеев (мьют/дефен) и трея. Подробности сборки - в [`desktop/README.md`](desktop/README.md).
* **Android APK:** Нативный клиент-контейнер с интеграцией системных звонков и автообновлением. Исходники в [`mobile/android/`](mobile/android/).

---

## Разработка и тестирование

```bash
# Установка всех зависимостей проекта
npm run install:all

# Запуск в dev-режиме (бэкенд :3001 + Vite HMR :5173)
npm run dev

# Запуск тестов
npm test --workspace server    # 130+ тестов API, БД, auth, WebRTC registry
npm test --workspace client    # тесты React-компонентов
```

---

## Лицензия

Проект распространяется под лицензией **[GNU AGPL v3](./LICENSE)**. Вы можете свободно использовать, модифицировать и хостить Sazcord при условии сохранения исходного кода открытым.

