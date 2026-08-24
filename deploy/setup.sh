#!/usr/bin/env bash
# =====================================================================
# Sazcord — установка «с нуля» на чистой Debian/Ubuntu (x86_64).
#
#   sudo bash deploy/setup.sh
#
# В отличие от install.sh (который только раскладывает код и юнит), этот
# скрипт доводит машину до рабочего состояния целиком:
#
#   1) ставит пакеты и Node 22 (нужен node:sqlite, см. server/src/db.js);
#   2) спрашивает базовые настройки и пишет их в server/.env;
#   3) спрашивает, как выпускать сертификат — на домен (Let's Encrypt)
#      или на голый IP (самоподписанный), и настраивает nginx;
#   4) поднимает systemd-юнит и проверяет, что сервер отвечает.
#
# Скрипт идемпотентен: повторный запуск обновляет код и конфиги, но не
# трогает уже существующие .env, загрузки и базу.
#
# Неинтерактивный режим — задать переменные окружения заранее:
#
#   SAZCORD_HOST=chat.example.com SAZCORD_TLS=letsencrypt \
#   SAZCORD_ACME_EMAIL=me@example.com SAZCORD_ADMINS=alice \
#   SAZCORD_ASSUME_YES=1 sudo -E bash deploy/setup.sh
# =====================================================================

set -euo pipefail

INSTALL_DIR="${SAZCORD_DIR:-/opt/sazcord}"
SERVICE_USER="${SAZCORD_USER:-sazcord}"
REPO_URL="${SAZCORD_REPO:-https://github.com/aaaSaZaN/sazcord.git}"
NGINX_SITE="/etc/nginx/sites-available/sazcord.conf"
SELF_SIGNED_DIR="/etc/ssl/sazcord"

# Значения, которые может переопределить окружение (см. шапку).
HOST="${SAZCORD_HOST:-}"
TLS_MODE="${SAZCORD_TLS:-}"           # letsencrypt | selfsigned
ACME_EMAIL="${SAZCORD_ACME_EMAIL:-}"
APP_PORT="${SAZCORD_PORT:-3001}"
ADMINS="${SAZCORD_ADMINS:-}"
REG_CODE="${SAZCORD_REGISTRATION_CODE:-}"
MAX_UPLOAD_MB="${SAZCORD_MAX_UPLOAD_MB:-500}"
RETENTION_DAYS="${SAZCORD_RETENTION_DAYS:-90}"
ASSUME_YES="${SAZCORD_ASSUME_YES:-}"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# ask <переменная> <вопрос> <значение по умолчанию>
# Если переменная уже задана окружением или включён ASSUME_YES — не спрашивает.
ask() {
  local __var="$1" __prompt="$2" __default="${3:-}" __cur __answer
  __cur="${!__var:-}"
  if [[ -n "$__cur" ]]; then return; fi
  if [[ -n "$ASSUME_YES" ]]; then printf -v "$__var" '%s' "$__default"; return; fi
  if [[ -n "$__default" ]]; then
    read -r -p "$__prompt [$__default]: " __answer </dev/tty || true
  else
    read -r -p "$__prompt: " __answer </dev/tty || true
  fi
  printf -v "$__var" '%s' "${__answer:-$__default}"
}

[[ $EUID -eq 0 ]] || die "Запускай через sudo — нужны права на /opt, nginx и systemd."
[[ -r /etc/os-release ]] || die "Не вижу /etc/os-release — скрипт рассчитан на Debian/Ubuntu."
. /etc/os-release
case "${ID:-}${ID_LIKE:-}" in
  *debian*|*ubuntu*) ;;
  *) warn "Дистрибутив '$ID' не Debian/Ubuntu — скрипт может не сработать." ;;
esac
[[ "$(uname -m)" == "x86_64" ]] || warn "Архитектура $(uname -m), а не x86_64 — обычно всё равно работает."

# --- 1. Пакеты -------------------------------------------------------
say "Ставлю системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git rsync openssl nginx

if ! command -v node >/dev/null 2>&1; then
  say "Ставлю Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs build-essential
fi

NODE_VER="$(node -v | sed -E 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MINOR="$(echo "$NODE_VER" | cut -d. -f2)"
# Минимум 22.5.0: база лежит в SQLite через встроенный node:sqlite,
# отдельного драйвера в зависимостях нет — на более старом Node сервер
# падает сразу на импорте.
if [[ "$NODE_MAJOR" -lt 22 ]] || { [[ "$NODE_MAJOR" -eq 22 ]] && [[ "$NODE_MINOR" -lt 5 ]]; }; then
  die "Нужен Node 22.5+ (сейчас v$NODE_VER). Обнови: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs"
fi

# --- 2. Вопросы ------------------------------------------------------
say "Настройки"

DEFAULT_HOST="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
ask HOST "Домен или IP, по которому будут заходить" "$DEFAULT_HOST"
[[ -n "$HOST" ]] || die "Без адреса не обойтись."

# Домен от IP отличаем по наличию букв: на голый IP публичный CA
# сертификат не выпишет, поэтому и выбор режимов разный.
IS_IP=0
[[ "$HOST" =~ ^[0-9.]+$ || "$HOST" == *:* ]] && IS_IP=1

if [[ -z "$TLS_MODE" ]]; then
  if [[ "$IS_IP" -eq 1 ]]; then
    warn "«$HOST» — это IP. Let's Encrypt на IP сертификаты не выдаёт, будет самоподписанный."
    TLS_MODE="selfsigned"
  else
    echo
    echo "  1) Let's Encrypt — настоящий сертификат. Нужно, чтобы домен $HOST"
    echo "     уже указывал A-записью на этот сервер, а порт 80 был открыт."
    echo "  2) Самоподписанный — заработает сразу, но браузер будет ругаться,"
    echo "     а десктоп/мобильный клиент может отказаться подключаться."
    echo
    CHOICE=""
    ask CHOICE "Как выпускать сертификат? 1/2" "1"
    [[ "$CHOICE" == "2" ]] && TLS_MODE="selfsigned" || TLS_MODE="letsencrypt"
  fi
fi

if [[ "$TLS_MODE" == "letsencrypt" ]]; then
  ask ACME_EMAIL "Email для Let's Encrypt (уведомления об истечении)" "admin@$HOST"
fi

ask APP_PORT "Локальный порт Node-сервера (nginx проксирует на него)" "3001"
ask ADMINS "Логины админов через запятую (получат админку при регистрации)" "admin"
ask REG_CODE "Общий код регистрации (пусто — только по персональным приглашениям)" ""
ask MAX_UPLOAD_MB "Максимальный размер файла, МБ" "500"
ask RETENTION_DAYS "Сколько дней хранить сообщения (0 — вечно)" "90"

ORIGIN="https://$HOST"

# --- 3. Код ----------------------------------------------------------
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$SRC_DIR/package.json" ]]; then
  # Скрипт скачали отдельно (curl | bash) — тянем репозиторий сами.
  SRC_DIR="/tmp/sazcord-src"
  say "Клонирую $REPO_URL"
  rm -rf "$SRC_DIR"
  git clone --depth 1 "$REPO_URL" "$SRC_DIR"
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  say "Создаю системного пользователя $SERVICE_USER"
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

say "Копирую код в $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# .env, загрузки и база остаются на месте — это данные, а не код.
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'server/.env' \
  --exclude 'server/uploads' \
  --exclude 'server/data' \
  "$SRC_DIR/" "$INSTALL_DIR/"

say "Ставлю зависимости и собираю клиент (это самая долгая часть)"
cd "$INSTALL_DIR"
# Ставим только то, что нужно серверу: npm run install:all тянет ещё и
# workspace desktop, а это electron на ~250 МБ, который на сервере не
# запускается никогда.
npm install --omit=dev --workspaces=false
npm --workspace server install --omit=dev
npm --workspace client install
npm run build

# --- 4. .env ---------------------------------------------------------
ENV_FILE="$INSTALL_DIR/server/.env"
if [[ -f "$ENV_FILE" ]]; then
  say ".env уже есть — оставляю как есть ($ENV_FILE)"
else
  say "Пишу $ENV_FILE"
  JWT_SECRET="$(openssl rand -hex 48)"
  {
    echo "# Сгенерировано deploy/setup.sh $(date -Is)"
    echo "PORT=$APP_PORT"
    echo "NODE_ENV=production"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "APP_ORIGIN=$ORIGIN"
    # Сервер за nginx: без этого express видит IP прокси вместо клиентского
    # и rate-limit считается на всех сразу.
    echo "TRUST_PROXY=1"
    echo "MAX_UPLOAD_MB=$MAX_UPLOAD_MB"
    if [[ "$RETENTION_DAYS" != "0" ]]; then echo "RETENTION_DAYS=$RETENTION_DAYS"; fi
    if [[ -n "$ADMINS" ]]; then echo "ADMIN_USERNAMES=$ADMINS"; fi
    if [[ -n "$REG_CODE" ]]; then echo "REGISTRATION_CODE=$REG_CODE"; fi
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

mkdir -p "$INSTALL_DIR/server/uploads" "$INSTALL_DIR/server/data" "$INSTALL_DIR/updates"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# --- 5. systemd ------------------------------------------------------
say "Ставлю systemd-юнит"
sed -e "s#/opt/sazcord#$INSTALL_DIR#g" \
    -e "s#^User=.*#User=$SERVICE_USER#" \
    -e "s#^Group=.*#Group=$SERVICE_USER#" \
    "$INSTALL_DIR/deploy/sazcord.service" > /etc/systemd/system/sazcord.service
systemctl daemon-reload
systemctl enable --now sazcord >/dev/null
systemctl restart sazcord

# --- 6. Сертификат ---------------------------------------------------
issue_selfsigned() {
  mkdir -p "$SELF_SIGNED_DIR"
  if [[ -f "$SELF_SIGNED_DIR/fullchain.pem" ]]; then
    say "Самоподписанный сертификат уже есть"
    return
  fi
  say "Выпускаю самоподписанный сертификат на $HOST"
  # SAN обязателен: браузеры и Electron давно игнорируют CN.
  local san="DNS:$HOST"
  [[ "$IS_IP" -eq 1 ]] && san="IP:$HOST"
  openssl req -x509 -nodes -newkey rsa:4096 -days 3650 \
    -keyout "$SELF_SIGNED_DIR/privkey.pem" \
    -out "$SELF_SIGNED_DIR/fullchain.pem" \
    -subj "/CN=$HOST" -addext "subjectAltName=$san" >/dev/null 2>&1
  chmod 600 "$SELF_SIGNED_DIR/privkey.pem"
}

CERT_PATH=""
KEY_PATH=""
if [[ "$TLS_MODE" == "letsencrypt" ]]; then
  CERT_PATH="/etc/letsencrypt/live/$HOST/fullchain.pem"
  KEY_PATH="/etc/letsencrypt/live/$HOST/privkey.pem"
  if [[ ! -f "$CERT_PATH" ]]; then
    # Сертификата ещё нет, а nginx с несуществующим путём не стартует.
    # Поэтому сначала поднимаем HTTP-конфиг, получаем сертификат, и уже
    # потом пишем полный HTTPS-конфиг.
    issue_selfsigned
    CERT_PATH="$SELF_SIGNED_DIR/fullchain.pem"
    KEY_PATH="$SELF_SIGNED_DIR/privkey.pem"
  fi
else
  issue_selfsigned
  CERT_PATH="$SELF_SIGNED_DIR/fullchain.pem"
  KEY_PATH="$SELF_SIGNED_DIR/privkey.pem"
fi

# --- 7. nginx --------------------------------------------------------
write_nginx() {
  local cert="$1" key="$2"
  # Директива `http2 on` появилась в nginx 1.25.1; в Debian 12 живёт 1.22,
  # где http2 включается флагом в listen. Без этой развилки nginx -t падает
  # на «unknown directive» и установка обрывается.
  local nginx_ver http2_listen="" http2_directive=""
  nginx_ver="$(nginx -v 2>&1 | sed -E 's#.*/([0-9.]+).*#\1#')"
  if [[ "$(printf '%s\n1.25.1\n' "$nginx_ver" | sort -V | head -1)" == "1.25.1" ]]; then
    http2_directive="  http2 on;"
  else
    http2_listen=" http2"
  fi
  cat > "$NGINX_SITE" <<NGINX
# Сгенерировано deploy/setup.sh. Правки переживут только до следующего
# запуска скрипта — держи свои изменения в отдельном файле.
server {
  listen 80;
  listen [::]:80;
  server_name $HOST;

  location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
  location / { return 301 https://\$host\$request_uri; }
}

server {
  listen 443 ssl${http2_listen};
  listen [::]:443 ssl${http2_listen};
${http2_directive}
  server_name $HOST;

  ssl_certificate     $cert;
  ssl_certificate_key $key;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_session_cache   shared:SSL:10m;

  # Должно быть не меньше MAX_UPLOAD_MB, иначе nginx срежет загрузку
  # раньше, чем сервер успеет ответить понятной ошибкой.
  client_max_body_size ${MAX_UPLOAD_MB}m;
  proxy_read_timeout  3600s;
  proxy_send_timeout  3600s;
  send_timeout        3600s;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "microphone=(self), camera=(self), display-capture=(self), geolocation=(), payment=()" always;

  # Звонки живут на socket.io — нужен апгрейд до websocket и выключенная
  # буферизация, иначе события копятся и голос «залипает».
  location /socket.io/ {
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_buffering off;
  }

  # Файлы: буферизацию запроса тоже выключаем, чтобы большие загрузки
  # не оседали целиком во временном файле nginx.
  location /uploads/ {
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_buffering off;
    proxy_request_buffering off;
  }

  location / {
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_pass http://127.0.0.1:$APP_PORT;
  }
}
NGINX
  mkdir -p /var/www/letsencrypt
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/sazcord.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx || systemctl restart nginx
}

say "Настраиваю nginx"
write_nginx "$CERT_PATH" "$KEY_PATH"

if [[ "$TLS_MODE" == "letsencrypt" && "$CERT_PATH" != "/etc/letsencrypt/live/$HOST/fullchain.pem" ]]; then
  say "Запрашиваю сертификат Let's Encrypt для $HOST"
  apt-get install -y -qq certbot python3-certbot-nginx
  if certbot certonly --webroot -w /var/www/letsencrypt \
      -d "$HOST" --agree-tos -m "$ACME_EMAIL" --non-interactive; then
    write_nginx "/etc/letsencrypt/live/$HOST/fullchain.pem" "/etc/letsencrypt/live/$HOST/privkey.pem"
    # Таймер обновления certbot ставит сам, но nginx после обновления надо
    # перечитать — иначе он будет отдавать старый сертификат до рестарта.
    mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  else
    warn "Let's Encrypt не выдал сертификат — остаётся самоподписанный."
    warn "Проверь, что A-запись $HOST смотрит сюда и порт 80 открыт, потом:"
    warn "  sudo certbot certonly --webroot -w /var/www/letsencrypt -d $HOST"
  fi
fi

# --- 8. Файрвол ------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Открываю порты в ufw"
  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
fi

# --- 8.5 TURN (опционально) ------------------------------------------
# Свой coturn нужен, если у кого-то из пользователей звонки не соединяются:
# строгий NAT, мобильный CGNAT, корпоративный firewall. Публичный STUN
# покрывает ~80% случаев, остальные 20% без TURN звонить не смогут.
TURN_WANT="${SAZCORD_TURN:-}"
TURN_DEFAULT=0
if [[ -z "$TURN_WANT" && -z "$ASSUME_YES" ]]; then
  echo
  echo "  Лучше сделать: свой TURN-сервер. Без него у части пользователей"
  echo "  (корпоративный NAT, мобильный интернет) звонки не соединятся."
  echo "  Ставит Docker-контейнер coturn и открывает порты 3478/tcp+udp"
  echo "  и 49152-65535/udp. Можно добавить потом:"
  echo "  sudo bash $INSTALL_DIR/deploy/turn/install.sh"
  TURN_DEFAULT=1
fi
ask TURN_WANT "Поднять coturn рядом с Sazcord? (лучше сделать) 1/0" "$TURN_DEFAULT"
if [[ "$TURN_WANT" == "1" ]]; then
  say "Ставлю TURN (deploy/turn/install.sh)"
  SAZCORD_DIR="$INSTALL_DIR" \
  SAZCORD_HOST="$HOST" \
  SAZCORD_ASSUME_YES="$ASSUME_YES" \
    bash "$INSTALL_DIR/deploy/turn/install.sh"
elif [[ "$TURN_WANT" != "0" ]]; then
  warn "Понял «$TURN_WANT» как «нет» — TURN пропускаю. Позже: sudo bash $INSTALL_DIR/deploy/turn/install.sh"
fi

# --- 9. Проверка -----------------------------------------------------
say "Проверяю, что всё поднялось"
sleep 2
LOCAL_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health" || true)"
EDGE_CODE="$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1/" -H "Host: $HOST" || true)"

echo
if [[ "$LOCAL_CODE" == "200" ]]; then
  echo "  Node-сервер:  OK (127.0.0.1:$APP_PORT)"
else
  echo "  Node-сервер:  НЕ ОТВЕЧАЕТ (код $LOCAL_CODE) — смотри journalctl -u sazcord -n 50"
fi
if [[ "$EDGE_CODE" == "200" ]]; then
  echo "  nginx + TLS:  OK"
else
  echo "  nginx + TLS:  код $EDGE_CODE — смотри journalctl -u nginx -n 50"
fi

cat <<INFO

Готово. Открывай $ORIGIN

  Регистрация закрыта по умолчанию: первый созданный аккаунт становится админом,
  дальше — только по приглашениям. Заведи свой аккаунт прямо сейчас.
  Настройки:   $ENV_FILE   (после правки: sudo systemctl restart sazcord)
  Логи:        sudo journalctl -u sazcord -f
  nginx:       $NGINX_SITE
  Обновление:  sudo bash deploy/setup.sh   (данные не тронет)
INFO

if [[ "$TLS_MODE" != "letsencrypt" || ! -f "/etc/letsencrypt/live/$HOST/fullchain.pem" ]]; then
  cat <<'INFO'
Сертификат самоподписанный: браузер покажет предупреждение, а десктоп- и
Android-клиент по такому адресу подключаться откажутся. Для нормальной
работы нужен домен и Let's Encrypt.
INFO
fi
