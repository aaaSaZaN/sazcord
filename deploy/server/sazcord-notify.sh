#!/usr/bin/env bash
# Sends a Telegram notification about sazcord service state.
# Usage: sazcord-notify.sh <event> (start|stop|fail)
#
# Reads secrets from /etc/sazcord-notify.env (see sazcord-notify.env.example).
# Silently no-ops if the env file or required vars are missing — never blocks
# systemd hooks.
set -u

event="${1:-unknown}"
case "$event" in
  start) icon="🟢"; text="Sazcord <b>запущен</b>" ;;
  stop)  icon="🔴"; text="Sazcord <b>остановлен</b>" ;;
  fail)  icon="⚠️"; text="Sazcord <b>упал</b>" ;;
  *)     icon="ℹ️"; text="Sazcord: $event" ;;
esac
env_file="${SAZCORD_NOTIFY_ENV:-/etc/sazcord-notify.env}"
[[ -r "$env_file" ]] || exit 0
# shellcheck disable=SC1090
. "$env_file"
[[ -n "${TG_BOT_TOKEN:-}" && -n "${TG_CHAT_ID:-}" ]] || exit 0

# hostname есть не везде (минимальные образы, Termux) — падать из-за этого
# уведомление не должно.
host=$(hostname 2>/dev/null || uname -n 2>/dev/null || echo unknown)
ts=$(date '+%Y-%m-%d %H:%M:%S %Z')
app_url="${SAZCORD_URL:-https://sazcord.example.com}"
msg="$icon $text
host: <code>$host</code>
url: $app_url
time: <code>$ts</code>"

IFS=',' read -ra chats <<< "$TG_CHAT_ID"
for chat in "${chats[@]}"; do
  chat="${chat// /}"
  [[ -z "$chat" ]] && continue
  curl -fsS --max-time 10 ${TG_PROXY:+--proxy "$TG_PROXY"} \
    -d "chat_id=$chat" \
    -d "parse_mode=HTML" \
    --data-urlencode "text=$msg" \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" >/dev/null || true
done
