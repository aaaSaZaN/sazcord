#!/usr/bin/env bash
# =====================================================================
# Sazcord — установка/обновление на сервере (Debian/Ubuntu).
# Запускать из корня репозитория, например:
#   sudo bash deploy/install.sh
#
# Скрипт:
#   1) Проверит, что Node 20+ установлен.
#   2) Установит зависимости и соберёт клиент.
#   3) Создаст системного пользователя sazcord (если ещё нет).
#   4) Скопирует репозиторий в /opt/sazcord (или обновит).
#   5) Создаст server/.env из примера, если его ещё нет.
#   6) Положит и активирует systemd-юнит.
#
# После установки нужно:
#   - отредактировать /opt/sazcord/server/.env
#   - sudo systemctl restart sazcord
#   - настроить nginx (см. deploy/nginx.conf.example)
# =====================================================================

set -euo pipefail

INSTALL_DIR="${SAZCORD_DIR:-/opt/sazcord}"
SERVICE_USER="sazcord"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Этот скрипт нужно запускать через sudo (требуются права на /opt и systemd)." >&2
  exit 1
fi

echo "==> Source: $SRC_DIR"
echo "==> Target: $INSTALL_DIR"

# 1) Node ------------------------------------------------------------
#
# Минимум — 22.5.0: сервер хранит данные в SQLite через встроенный модуль
# `node:sqlite` (см. server/src/db.js), а он появился именно в 22.5.
# Отдельного драйвера в зависимостях нет, поэтому на Node 20/21 и на
# 22.0–22.4 сервер падает сразу на импорте. Раньше скрипт ставил Node 20
# и проверял `>= 20` — то есть на чистой машине оставлял нерабочую
# установку.
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Устанавливаю Node 22 LTS из NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs build-essential
fi

NODE_VER=$(node -v | sed -E 's/^v//')
NODE_MAJOR=${NODE_VER%%.*}
NODE_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
if [[ "$NODE_MAJOR" -lt 22 ]] || { [[ "$NODE_MAJOR" -eq 22 ]] && [[ "$NODE_MINOR" -lt 5 ]]; }; then
  echo "Нужен Node 22.5 или новее — в нём появился node:sqlite (сейчас v$NODE_VER)." >&2
  exit 1
fi

# 2) Системный пользователь ------------------------------------------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "==> Создаю пользователя $SERVICE_USER"
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# 3) Каталог установки -----------------------------------------------
mkdir -p "$INSTALL_DIR"
echo "==> Синхронизирую файлы в $INSTALL_DIR"
# rsync, чтобы не перетереть .env и uploads/.
# server/data — база, server/uploads — вложения, updates/ — установщики для
# автообновления клиентов. Ничего из этого нет в репозитории, поэтому без
# явных исключений --delete стирал бы их при каждом обновлении.
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'server/.env' \
  --exclude 'server/uploads' \
  --exclude 'server/data' \
  --exclude 'updates' \
  "$SRC_DIR/" "$INSTALL_DIR/"

# 4) Зависимости + сборка клиента -----------------------------------
# Намеренно НЕ `npm run install:all`: он ставит и desktop-воркспейс, а это
# electron (~100 МБ), electron-builder, sharp и нативные uiohook-napi /
# application-loopback, которым нужен компилятор. Серверу нужны только его
# рантайм-зависимости плюс devDeps клиента, без которых не собрать фронт.
echo "==> npm install (server + client, без desktop)"
cd "$INSTALL_DIR"
npm install --omit=dev --workspaces=false
npm --workspace server install --omit=dev
npm --workspace client install
echo "==> npm run build (клиент)"
npm run build

# 5) .env -------------------------------------------------------------
if [[ ! -f "$INSTALL_DIR/server/.env" ]]; then
  cp "$INSTALL_DIR/server/.env.example" "$INSTALL_DIR/server/.env"
  # Сгенерируем сильный JWT_SECRET автоматически, чтобы юзер точно не оставил дефолт.
  RAND_SECRET=$(openssl rand -hex 48)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$INSTALL_DIR/server/.env"
  echo
  echo "!!! Создан $INSTALL_DIR/server/.env — обязательно проверь его и"
  echo "!!! при необходимости задай REGISTRATION_CODE."
  echo
fi

# 6) Права ------------------------------------------------------------
mkdir -p "$INSTALL_DIR/server/uploads" "$INSTALL_DIR/server/data" "$INSTALL_DIR/updates"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# 7) systemd ----------------------------------------------------------
SYSTEMD_DST="/etc/systemd/system/sazcord.service"
if [[ ! -f "$SYSTEMD_DST" ]] || ! cmp -s "$INSTALL_DIR/deploy/sazcord.service" "$SYSTEMD_DST"; then
  echo "==> Обновляю $SYSTEMD_DST"
  cp "$INSTALL_DIR/deploy/sazcord.service" "$SYSTEMD_DST"
  systemctl daemon-reload
fi

systemctl enable sazcord
systemctl restart sazcord

echo
echo "==> Готово."
echo "    Логи:    sudo journalctl -u sazcord -f"
echo "    Статус:  sudo systemctl status sazcord"
echo "    .env:    sudo -u $SERVICE_USER \$EDITOR $INSTALL_DIR/server/.env"
