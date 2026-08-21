// Idle/away детектор: после IDLE_THRESHOLD_MS неактивности шлёт серверу
// 'presence:away'; при любой активности (mousemove/keydown/touchstart/
// focus/visibilitychange→visible) — 'presence:active'. Сервер агрегирует
// и бродкастит всем подписчикам соответствующее обновление presence.
//
// Что считается «активностью»:
//   - движение мыши или нажатие клавиши в окне (стандартный паттерн);
//   - touch (мобила);
//   - возврат в окно после Alt+Tab — focus event;
//   - переключение на вкладку из фона — visibilitychange.
//
// Что НЕ считается активностью:
//   - воспроизведение видео/звонок без юзер-инпута. Это сознательный
//     выбор: если ты слушаешь подкаст и реально не у компа — ты away.
//     В реальном звонке это спорно (можно сидеть и слушать), но пока
//     оставляем простой паттерн как в Discord/Telegram.
//
// Cleanup:
//   - useEffect при unmount чистит таймер и слушатели.
//   - При смене socket'а или enabled - то же самое (вернёмся к active
//     при следующем коннекте через эффект-цепочку).
//
// Замечания по производительности:
//   - mousemove приходит десятки раз в секунду; чтобы не флудить таймер
//     setTimeout/clearTimeout на каждый event, throttle'им до 1 раза
//     в 5 секунд через timestamp-флаг lastReset.
//   - presence:active отправляется только если мы РЕАЛЬНО были away.
//     Дубликаты не шлём (сервер тоже идемпотентен, но клиентская проверка
//     дешевле и надёжнее).

import { useEffect } from 'react';
import type { SazcordSocket } from '../types';

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 минут
const RESET_THROTTLE_MS = 5_000; // не чаще раза в 5 сек

export function useIdleDetection(socket: SazcordSocket | null, enabled = true): void {
  useEffect(() => {
    if (!socket || !enabled) return;

    let timer: number | null = null;
    let isAway = false;
    let lastReset = 0;

    const goAway = () => {
      if (isAway) return;
      isAway = true;
      timer = null;
      try {
        socket.emit('presence:away');
      } catch {
        /* socket disconnected — server при reconnect'е увидит свежий active */
      }
    };

    const armTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(goAway, IDLE_THRESHOLD_MS);
    };

    const reset = () => {
      const now = Date.now();
      // Throttle: между двумя ресетами должно пройти минимум 5 сек.
      // mousemove на macbook trackpad'е может прилетать 100 раз/сек —
      // без throttle мы бы спамили clearTimeout/setTimeout впустую.
      if (now - lastReset < RESET_THROTTLE_MS && !isAway) return;
      lastReset = now;
      armTimer();
      // Если мы были away — поднимаем active. Если нет — просто продлили
      // таймер до следующих 5 минут.
      if (isAway) {
        isAway = false;
        try {
          socket.emit('presence:active');
        } catch {
          /* same as above */
        }
      }
    };

    const onVisibility = () => {
      // Возврат на вкладку — это явный сигнал «я тут»; считаем за reset
      // (даже если последний reset был 1 сек назад — переход видимый,
      // юзер ожидает что статус мгновенно обновится).
      if (!document.hidden) {
        lastReset = 0; // принудительно пробьём throttle
        reset();
      }
    };

    // 'mousemove' и 'mousedown' — десктоп; 'touchstart' — мобила; 'keydown'
    // — клавиатура; 'focus' — возврат в окно после Alt+Tab.
    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'focus',
    ];
    for (const e of events) {
      window.addEventListener(e, reset, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);

    // Стартовая инициализация: запускаем таймер сразу. Если за 5 минут
    // ни одного reset'а — улетим в away.
    armTimer();

    return () => {
      if (timer !== null) clearTimeout(timer);
      for (const e of events) {
        window.removeEventListener(e, reset);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [socket, enabled]);
}
