# coturn рядом с Sazcord

Готовый docker-compose, чтобы поднять собственный TURN за 2 минуты.
Нужен, если у кого-то из пользователей звонки не устанавливаются (строгий
NAT, мобильный CGNAT, корпоративный firewall). На публичном Google STUN
работает в ~80% случаев; оставшимся 20% поможет этот сервис.

## Быстрый старт

1. Убедись, что на сервере установлен Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER  # перелогинься после
   ```
2. Подготовь конфиг:
   ```bash
   cd deploy/turn
   cp .env.example .env
   nano .env
   # REALM            - твой домен
   # TURN_USERNAME    - логин (любой, обычно sazcord)
   # TURN_PASSWORD    - длинный пароль (openssl rand -hex 24)
   # EXTERNAL_IP      - публичный IP сервера (команда: curl -s ifconfig.me)
   nano turnserver.conf
   # Подставь те же значения: realm, user:password, external-ip
   ```
3. Запусти:
   ```bash
   docker compose up -d
   docker compose logs -f
   ```
4. Открой порты на firewall:
   ```bash
   sudo ufw allow 3478
   sudo ufw allow 49152:65535/udp
   ```
5. Пропиши клиенту в `server/.env`:
   ```
   TURN_URL=turn:sazcord.example.com:3478
   TURN_USERNAME=sazcord
   TURN_PASSWORD=тот-же-пароль
   ```
   И перезапусти приложение:
   ```bash
   sudo systemctl restart sazcord
   ```

## Проверка

Удобный онлайн-тест: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Добавь туда свой TURN URL/username/password, нажми "Gather candidates".
Должен появиться хотя бы один кандидат с типом `relay` - значит сервер
работает и доступен извне.

## TLS / turns://

Если хочешь `turns://` на 5349 (чтобы работало из-за строгих firewall,
блокирующих UDP), раскомментируй секцию TLS в `turnserver.conf` и
смонтируй `/etc/letsencrypt` в docker-compose. Используй те же сертификаты,
что выдал certbot для основного домена.

## Обновления

```bash
cd deploy/turn
docker compose pull
docker compose up -d
```

## Остановить

```bash
docker compose down
```
