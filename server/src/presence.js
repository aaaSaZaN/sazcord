// Reference-counted отслеживание онлайн-юзеров (userId -> количество сокетов).
const counts = new Map();

// Away/idle state: множество юзеров, которые помечены как «отошёл» хотя
// бы одним из своих клиентов. Любой клиент шлёт presence:away/active
// независимо, и сервер агрегирует — если КАК МИНИМУМ один клиент юзера
// активен, юзер не считается idle (что логично: если у тебя открыт
// телефон, но компьютер заснул — ты всё ещё online).
//
// На практике сейчас агрегация простая: если приходит presence:away —
// помечаем away; если presence:active — снимаем. Поскольку клиент шлёт
// active при любой активности и away после 5 минут idle на этом
// конкретном устройстве, для multi-device случая это даёт ожидаемое
// поведение: пока хоть один клиент видит активность — юзер online.
const awayUsers = new Set();

export function addUserSocket(userId) {
  counts.set(userId, (counts.get(userId) || 0) + 1);
  return counts.get(userId) === 1; // true если пользователь только что стал онлайн
}

export function removeUserSocket(userId) {
  const n = counts.get(userId) || 0;
  if (n <= 1) {
    counts.delete(userId);
    // При уходе в оффлайн сбрасываем away-флаг — иначе при следующем
    // коннекте юзер моментально будет показан как «отошёл», что
    // некорректно (он только что снова стал online).
    awayUsers.delete(userId);
    return true; // пользователь ушёл в оффлайн
  }
  counts.set(userId, n - 1);
  return false;
}

export function getOnlineUserIds() {
  return new Set(counts.keys());
}

export function isOnline(userId) {
  return counts.has(userId);
}

// --- Idle/away --------------------------------------------------------

/**
 * Устанавливает away-флаг юзера. Возвращает true, если значение
 * реально изменилось (т.е. нужно бродкастить событие).
 *
 * Если юзер сейчас оффлайн — set'ить away не разрешаем (away имеет смысл
 * только поверх online).
 */
export function setAway(userId, away) {
  if (away) {
    if (!counts.has(userId)) return false; // не online — нельзя away
    if (awayUsers.has(userId)) return false;
    awayUsers.add(userId);
    return true;
  } else {
    return awayUsers.delete(userId);
  }
}

export function isAway(userId) {
  return awayUsers.has(userId);
}

export function getAwayUserIds() {
  return new Set(awayUsers);
}
