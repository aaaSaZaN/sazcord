#!/usr/bin/env bash
# Idempotently installs the server-side helpers needed for Sazcord:
#   - /usr/local/bin/sazcord-deploy.sh   (deploy script, used by CI)
#   - /usr/local/bin/sazcord-notify.sh   (Telegram alerts)
#   - /etc/sudoers.d/sazcord-deploy      (NOPASSWD entry for gitlab-runner)
#   - /etc/systemd/system/sazcord.service (systemd unit with start/stop hooks)
#
# Telegram secrets live in /etc/sazcord-notify.env (NOT in this repo).
# See sazcord-notify.env.example for the format.
#
# Run as root from inside this directory:
#   sudo bash install-server-tools.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "must run as root (use sudo)" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> installing /usr/local/bin/sazcord-deploy.sh"
install -m 0750 -o root -g gitlab-runner "$HERE/sazcord-deploy.sh" /usr/local/bin/sazcord-deploy.sh

echo "==> installing /usr/local/bin/sazcord-notify.sh"
install -m 0755 -o root -g root "$HERE/sazcord-notify.sh" /usr/local/bin/sazcord-notify.sh

echo "==> installing /etc/sudoers.d/sazcord-deploy"
install -m 0440 -o root -g root "$HERE/sudoers.d-sazcord-deploy" /etc/sudoers.d/sazcord-deploy
visudo -cf /etc/sudoers.d/sazcord-deploy

echo "==> installing /etc/systemd/system/sazcord.service"
install -m 0644 -o root -g root "$HERE/sazcord.service" /etc/systemd/system/sazcord.service
systemctl daemon-reload

if [[ ! -f /etc/sazcord-notify.env ]]; then
  echo
  echo "!!! /etc/sazcord-notify.env is missing — Telegram alerts will be silent."
  echo "!!! Copy sazcord-notify.env.example there and fill in TG_BOT_TOKEN / TG_CHAT_ID."
fi

echo "==> done"
