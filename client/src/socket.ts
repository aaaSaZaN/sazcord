import { io } from 'socket.io-client';
import type { SazcordSocket } from './types';

let socket: SazcordSocket | null = null;
// Токен, с которым был создан текущий инстанс. Нужен, чтобы отличить
// «тот же самый юзер, просто повторный вызов» от «сменился аккаунт».
let currentToken: string | null = null;

/**
 * Вернуть (создав при необходимости) сокет для данного токена.
 *
 * ВАЖНО: раньше здесь стояла проверка `if (socket && socket.connected)`.
 * Она ломала первый заход на страницу: AuthContext дёргает connectSocket
 * дважды почти подряд (в инициализаторе useState и в эффекте), и во второй
 * раз socket ещё НЕ успевал перейти в connected — старый инстанс убивался
 * `disconnect()` прямо посреди handshake'а, а на его месте создавался
 * новый. Сервер при этом успевал увидеть connect+disconnect и рассылал
 * лишние presence-события (юзер моргал «онлайн → оффлайн → онлайн»), а
 * иногда просто терялись `presence:list` / `call:invite`, отправленные в
 * умирающий сокет. Отсюда и жалобы «человек с сайта не появляется в сети
 * и ему не дозвониться».
 *
 * Теперь пересоздаём соединение ТОЛЬКО при смене токена.
 */
export function connectSocket(token: string): SazcordSocket {
  if (socket && currentToken === token) {
    // `active` = сокет подключён либо в процессе (re)подключения.
    if (!socket.active) socket.connect();
    return socket;
  }
  if (socket) socket.disconnect();
  currentToken = token;
  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
  return socket;
}

export function getSocket(): SazcordSocket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentToken = null;
}
