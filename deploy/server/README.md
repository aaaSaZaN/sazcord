# Server-side deploy tools

Файлы для разворачивания CI-цепочки и Telegram-уведомлений на сервере.
В рантайме не используются - нужны только при первичной настройке хоста
(или при пересоздании сервера).

| Файл                         | Где живёт                             | Что делает                                                                                                                                |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `sazcord-deploy.sh`          | `/usr/local/bin/sazcord-deploy.sh`    | rsync кода в `/apps/prod/Sazcord` (каталог берётся из `SAZCORD_TARGET_DIR`), установка зависимостей server+client без desktop-воркспейса, `npm run build`, `systemctl restart sazcord`. Вызывается из `.gitlab-ci.yml` через sudo. |
| `sazcord-notify.sh`          | `/usr/local/bin/sazcord-notify.sh`    | Шлёт сообщение в Telegram (`start`/`stop`/`fail`). Подхватывается systemd-юнитом через `ExecStartPost` / `ExecStopPost`.                  |
| `sazcord-notify.env.example` | (template)                            | Образец для `/etc/sazcord-notify.env` - там реальные `TG_BOT_TOKEN` и `TG_CHAT_ID` (в репо не коммитятся).                                |
| `sazcord.service`            | `/etc/systemd/system/sazcord.service` | systemd-юнит для сервиса.                                                                                                                 |
| `sudoers.d-sazcord-deploy`   | `/etc/sudoers.d/sazcord-deploy`       | NOPASSWD-разрешение для `gitlab-runner` дёргать `sazcord-deploy.sh`.                                                                      |
| `install-server-tools.sh`    | (запускается на сервере)              | Раскладывает все файлы по нужным путям.                                                                                                   |

## Первая установка

```bash
# на сервере, из чекаута репо:
cd deploy/server
sudo bash install-server-tools.sh

# затем создаём env с секретами:
sudo cp sazcord-notify.env.example /etc/sazcord-notify.env
sudo chmod 0640 /etc/sazcord-notify.env
sudo nano /etc/sazcord-notify.env   # заполнить TG_BOT_TOKEN, TG_CHAT_ID, TG_PROXY

sudo systemctl restart sazcord
```

## CI runner

Раннер с тегом `deploy` регистрируется отдельно один раз:

```bash
sudo gitlab-runner register --non-interactive \
  --url https://gitlab.com \
  --token <RUNNER_REGISTRATION_TOKEN> \
  --executor shell \
  --description "sazcord-deploy"
```

После этого пуш в `main` запускает job из `.gitlab-ci.yml`.
