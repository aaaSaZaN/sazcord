#!/usr/bin/env bash
# Privileged deploy script for Sazcord. Called from CI as:
#   sudo /usr/local/bin/sazcord-deploy.sh <source-dir>
# Whitelisted via /etc/sudoers.d/sazcord-deploy for the gitlab-runner user.
set -euo pipefail

SRC="${1:?usage: sazcord-deploy.sh <source-dir>}"
TARGET="${SAZCORD_TARGET_DIR:-/apps/prod/Sazcord}"

if [[ ! -d "$SRC" ]]; then
  echo "source dir not found: $SRC" >&2
  exit 1
fi

echo "==> rsync $SRC -> $TARGET"
# updates/ не лежит в репозитории (см. .gitignore), поэтому в $SRC его нет.
# Без явного исключения --delete снёс бы установщики и манифесты на боевом
# хосте, и автообновление клиентов молча перестало бы работать.
#
# Если UPLOADS_DIR / SAZCORD_DB_FILE / UPDATES_DIR в server/.env указывают
# наружу из $TARGET — они под --delete не попадают в принципе, но и
# ReadWritePaths в юните под них надо расширить.
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='server/.env' \
  --exclude='server/uploads' \
  --exclude='server/data' \
  --exclude='updates' \
  "$SRC/" "$TARGET/"

echo "==> chown sazcord"
chown -R sazcord:sazcord "$TARGET"

echo "==> npm install + build (as sazcord)"
cd "$TARGET"
# Намеренно НЕ `npm run install:all`: тот проходит по всем воркспейсам, включая
# desktop, и тянет на сервер electron (~100 МБ), electron-builder, sharp и
# нативные uiohook-napi / application-loopback, которым нужен компилятор.
# Серверу нужны только его рантайм-зависимости и devDeps клиента для сборки.
sudo -u sazcord -H bash -c '
  npm install --omit=dev --workspaces=false &&
  npm --workspace server install --omit=dev &&
  npm --workspace client install &&
  npm run build' 2>&1 | tail -20

echo "==> restart systemd service"
systemctl restart sazcord
sleep 3
systemctl is-active sazcord

HEALTH_PORT="${SAZCORD_PORT:-3001}"
if [[ -f "$TARGET/server/.env" ]]; then
  # `PORT=3001 # комментарий` — обычная строка в .env, поэтому хвост после
  # значения срезаем, иначе curl получит порт вида «3001#комментарий».
  PORT_FROM_ENV=$(grep -E '^\s*PORT=' "$TARGET/server/.env" | head -1 | cut -d= -f2 | sed -E 's/[[:space:]]*#.*$//' | tr -d " \"'" || true)
  if [[ -n "$PORT_FROM_ENV" ]]; then
    HEALTH_PORT="$PORT_FROM_ENV"
  fi
fi

curl -sS "http://127.0.0.1:${HEALTH_PORT}/api/health"
echo
echo "==> deploy OK"
