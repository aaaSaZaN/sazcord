// Применение выбранного устройства вывода к <audio>/<video>.
//
// Наивный `el.setSinkId(id)` ломается на протухших id: Chromium (и Electron
// вместе с ним) выдаёт deviceId, привязанный к сессии/соли origin'а. После
// перезапуска приложения, смены наушников или переключения профиля звука
// сохранённый в настройках id указывает в никуда. Элемент при этом остаётся
// «играющим» — событие play проходит, кнопка переключается в Pause, — но
// аудио-рендерер молчит и currentTime не двигается. Ровно так выглядели
// «неработающие голосовые» в десктопе.
//
// Поэтому: перед setSinkId проверяем, что устройство реально есть в
// enumerateDevices, а при любой осечке откатываемся на системный вывод ('').
export async function applySinkId(
  el: HTMLMediaElement | null | undefined,
  deviceId?: string | null,
): Promise<void> {
  const anyEl = el as (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null;
  if (!anyEl || typeof anyEl.setSinkId !== 'function') return;

  const wanted = !deviceId || deviceId === 'default' ? '' : deviceId;

  if (wanted) {
    let exists = false;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      exists = devices.some((d) => d.kind === 'audiooutput' && d.deviceId === wanted);
    } catch {
      // Нет доступа к списку устройств — пробуем как есть, ошибку поймаем ниже.
      exists = true;
    }
    if (exists) {
      try {
        await anyEl.setSinkId(wanted);
        return;
      } catch (e) {
        console.warn('[audio] setSinkId failed, falling back to default sink', wanted, e);
      }
    } else {
      console.warn('[audio] output device is gone, falling back to default sink', wanted);
    }
  }

  try {
    await anyEl.setSinkId('');
  } catch {
    /* браузер без поддержки выбора вывода — остаётся системный по умолчанию */
  }
}
