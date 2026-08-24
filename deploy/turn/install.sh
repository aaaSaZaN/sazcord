#!/usr/bin/env bash
# =====================================================================
# Sazcord — установка/обновление собственного TURN-сервера (coturn).
#
#   sudo bash deploy/turn/install.sh
#
# Нужен, если у кого-то из пользователей звонки не соединяются:
# строгий NAT, мобильный CGNAT, корпоративный firewall. Без TURN
# всё работает как раньше — скрипт ничего не ломает, а добавляет
# запасной путь для медиа.
#
# Что делает:
#   1) ставит Docker и compose, если их нет;
#   2) генерирует пароль TURN и рендерит готовый конфиг в
#      /etc/sazcord-coturn/turnserver.conf (секреты мимо git);
#   3) пишет deploy/turn/.env и поднимает контейнер sazcord-coturn;
#   4) открывает в ufw порты 3478/tcp+udp и 49152-65535/udp;
#   5) прописывает TURN_URL/TURN_USERNAME/TURN_PASSWORD в server/.env
#      и перезапускает sazcord (если юнит установлен).
#
# Идемпотентен: повторный запуск обновляет конфиг и контейнер,
# существующий пароль не меняет.
#
# Неинтерактивно (например, из setup.sh или CI):
#   SAZCORD_HOST=chat.example.com SAZCORD_ASSUME_YES=1 \
#     sudo -E bash deploy/turn/install.sh
# =====================================================================

set -euo pipefail

INSTALL_DIR="${SAZCORD_DIR:-/opt/sazcord}"
TURN_DIR="$INSTALL_DIR/deploy/turn"
APP_ENV_FILE="${SAZCORD_APP_ENV:-$INSTALL_DIR/server/.env}"
COTURN_CONF_DIR="/etc/sazcord-coturn"
TURN_USERNAME="${SAZCORD_TURN_USER:-sazcord}"
TURN_PASSWORD="${SAZCORD_TURN_PASSWORD:-}"
HOST="${SAZCORD_HOST:-}"
EXTERNAL_IP="${SAZCORD_EXTERNAL_IP:-}"
ASSUME_YES="${SAZCORD_ASSUME_YES:-}"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

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

[[ $EUID -eq 0 ]] || die "Запускай через sudo — нужны docker, /etc и firewall."
[[ -f "$APP_ENV_FILE" ]] || die "Не найден $APP_ENV_FILE — сначала поставь Sazcord (deploy/setup.sh)."

# --- 1. Адреса -------------------------------------------------------
detect_public_ip() {
  curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null \
    || hostname -I | awk '{print $1}'
}

if [[ -z "$HOST" ]]; then
  # Домен берём из APP_ORIGIN основного .env — там его пишет setup.sh.
  HOST="$(sed -n 's/^APP_ORIGIN=https:\/\///p' "$APP_ENV_FILE" | head -1)"
fi
DEFAULT_EXT_IP="$(detect_public_ip)"
ask HOST "Домен или публичный IP для TURN" "${HOST:-$DEFAULT_EXT_IP}"
[[ -n "$HOST" ]] || die "Без адреса не обойтись."
ask EXTERNAL_IP "Публичный IP сервера (для external-ip в coturn)" "${EXTERNAL_IP:-$DEFAULT_EXT_IP}"
[[ -n "$EXTERNAL_IP" ]] || die "Без внешнего IP relay работать не будет."

# --- 2. Docker -------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Ставлю Docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq docker.io >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
fi

COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    say "Ставлю compose-плагин"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    # docker-compose-v2 есть в Ubuntu 22.04+/Debian 13; на старых системах
    # остаётся python-обёртка v1 с бинарём docker-compose.
    apt-get install -y -qq docker-compose-v2 >/dev/null 2>&1 \
      || apt-get install -y -qq docker-compose >/dev/null
    if docker compose version >/dev/null 2>&1; then
      COMPOSE=(docker compose)
    else
      COMPOSE=(docker-compose)
    fi
  fi
fi

# --- 3. Пароль и конфиг ----------------------------------------------
TURN_ENV_FILE="$TURN_DIR/.env"
if [[ -z "$TURN_PASSWORD" && -f "$TURN_ENV_FILE" ]]; then
  # Повторный запуск: пароль уже сгенерирован — оставляем тот же,
  # иначе у клиентов в .env приложения он разъедется с coturn.
  TURN_PASSWORD="$(sed -n 's/^TURN_PASSWORD=//p' "$TURN_ENV_FILE" | head -1)"
fi
if [[ -z "$TURN_PASSWORD" ]]; then
  TURN_PASSWORD="$(openssl rand -hex 24)"
fi

say "Рендерю конфиг coturn в $COTURN_CONF_DIR/turnserver.conf"
mkdir -p "$COTURN_CONF_DIR"
cat > "$COTURN_CONF_DIR/turnserver.conf" <<CONF
# Сгенерировано deploy/turn/install.sh $(date -Is).
# Правки руками переживут только до следующего запуска скрипта —
# правьте шаблон в deploy/turn/install.sh.

listening-port=3478

# external-ip обязателен: без него coturn не знает, какой адрес
# отдавать пирам в кандидатах, и relay не работает за NAT VPS.
external-ip=$EXTERNAL_IP

min-port=49152
max-port=65535

fingerprint
lt-cred-mech
realm=$HOST
user=$TURN_USERNAME:$TURN_PASSWORD

no-multicast-peers
no-cli
no-loopback-peers

# Запрещаем relay на приватные сети — защита от SSRF через свой TURN.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-239.255.255.255
denied-peer-ip=240.0.0.0-255.255.255.255

log-file=stdout
simple-log
CONF
chmod 600 "$COTURN_CONF_DIR/turnserver.conf"

# --- 4. .env для compose и запуск ------------------------------------
mkdir -p "$TURN_DIR"
cat > "$TURN_ENV_FILE" <<TENV
# Сгенерировано deploy/turn/install.sh $(date -Is)
REALM=$HOST
TURN_USERNAME=$TURN_USERNAME
TURN_PASSWORD=$TURN_PASSWORD
EXTERNAL_IP=$EXTERNAL_IP
# Готовый конфиг с секретами лежит вне репозитория:
TURN_CONF=$COTURN_CONF_DIR/turnserver.conf
TENV
chmod 600 "$TURN_ENV_FILE"

say "Поднимаю контейнер sazcord-coturn"
(cd "$TURN_DIR" && "${COMPOSE[@]}" up -d)

sleep 2
if ! docker ps --format '{{.Names}}' | grep -qx 'sazcord-coturn'; then
  warn "Контейнер не поднялся. Логи:"
  (cd "$TURN_DIR" && "${COMPOSE[@]}" logs --tail 30) >&2 || true
  die "coturn не запустился — разберись с логами выше."
fi

# --- 5. Firewall -----------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Открываю порты в ufw"
  ufw allow 3478/tcp >/dev/null || true
  ufw allow 3478/udp >/dev/null || true
  ufw allow 49152:65535/udp >/dev/null || true
else
  warn "ufw не активен — проверь, что 3478/tcp+udp и 49152-65535/udp открыты на firewall провайдера."
fi

# --- 6. Прописываем TURN в приложение --------------------------------
say "Прописываю TURN в $APP_ENV_FILE"
ENV_UID="$(stat -c '%u' "$APP_ENV_FILE")"
ENV_GID="$(stat -c '%g' "$APP_ENV_FILE")"
ENV_MODE="$(stat -c '%a' "$APP_ENV_FILE")"
sed -i '/^TURN_URL=/d;/^TURN_USERNAME=/d;/^TURN_PASSWORD=/d' "$APP_ENV_FILE"
{
  echo "TURN_URL=turn:$HOST:3478"
  echo "TURN_USERNAME=$TURN_USERNAME"
  echo "TURN_PASSWORD=$TURN_PASSWORD"
} >> "$APP_ENV_FILE"
chown "$ENV_UID:$ENV_GID" "$APP_ENV_FILE"
chmod "$ENV_MODE" "$APP_ENV_FILE"

if systemctl is-active --quiet sazcord 2>/dev/null; then
  systemctl restart sazcord
  say "sazcord перезапущен — клиенты получат ICE с TURN при следующем коннекте"
else
  warn "Юнит sazcord не найден/не активен — перезапусти приложение сам, чтобы оно прочитало TURN_* из .env."
fi

LISTENING="$(ss -ulnp 2>/dev/null | grep -c ':3478' || true)"

cat <<INFO

Готово. coturn работает: turn:$HOST:3478 (user: $TURN_USERNAME)

  Проверка из браузера: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
  Добавь TURN URL/логин/пароль, нажми Gather candidates — должен
  появиться кандидат типа «relay». Без него проверь firewall провайдера:
  снаружи должны быть доступны 3478/tcp+udp и 49152-65535/udp.

  Конфиг:   $COTURN_CONF_DIR/turnserver.conf
  Логи:     cd $TURN_DIR && ${COMPOSE[*]} logs -f
  Обновить: cd $TURN_DIR && ${COMPOSE[*]} pull && ${COMPOSE[*]} up -d
  Убрать:   cd $TURN_DIR && ${COMPOSE[*]} down
            (и удали TURN_* строки из $APP_ENV_FILE)
INFO

if [[ "$LISTENING" == "0" ]]; then
  warn "Порт 3478/udp пока не слушается — смотри логи контейнера."
fi
