// Мост в Android-обёртку (mobile/android). На вебе и в Electron все
// функции — no-op, поэтому вызывать их можно безусловно.
//
// Нативная сторона: MainActivity.Bridge, экспонируется как
// window.SazcordAndroid через addJavascriptInterface.

type AndroidBridge = {
  setCallActive?: (active: boolean) => void;
  getVersion?: () => string;
  checkUpdate?: () => void;
  promptServer?: () => void;
  leaveServer?: () => void;
  reload?: () => void;
};

function bridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { SazcordAndroid?: AndroidBridge }).SazcordAndroid;
  return b && typeof b === 'object' ? b : null;
}

export function isAndroidShell(): boolean {
  return !!bridge();
}

/**
 * Сообщить обёртке, что идёт (или закончился) звонок.
 *
 * Зачем это вообще нужно: Android замораживает процесс свёрнутого
 * приложения, и WebRTC внутри WebView просто перестаёт слать пакеты —
 * собеседник слышит тишину, через пару минут соединение рвётся. Пока
 * висит foreground-сервис с типом microphone, система процесс не трогает.
 * Сервис поднимается ровно на время разговора, чтобы не держать
 * постоянную нотификацию впустую.
 */
export function setAndroidCallActive(active: boolean): void {
  const b = bridge();
  if (!b?.setCallActive) return;
  try {
    b.setCallActive(!!active);
  } catch {
    /* обёртка старой версии — не критично */
  }
}

/** Версия нативной обёртки (не веб-клиента). null вне Android. */
export function androidVersion(): string | null {
  const b = bridge();
  if (!b?.getVersion) return null;
  try {
    return b.getVersion() || null;
  } catch {
    return null;
  }
}

/** Ручная проверка обновления APK. */
export function androidCheckUpdate(): void {
  const b = bridge();
  if (!b?.checkUpdate) return;
  try {
    b.checkUpdate();
  } catch {
    /* */
  }
}

/**
 * Забыть сервер и вернуться на экран первичной настройки.
 *
 * Обёртка сама чистит WebStorage — то есть и JWT в localStorage. Иначе
 * при возврате на тот же адрес юзер молча оказался бы залогинен под
 * прежним аккаунтом, хотя визуально «вышел».
 *
 * Возвращает false, если обёртка старая и метода ещё не знает — вызывающий
 * может показать понятную ошибку вместо тихого бездействия.
 */
export function androidLeaveServer(): boolean {
  const b = bridge();
  if (!b?.leaveServer) return false;
  try {
    b.leaveServer();
    return true;
  } catch {
    return false;
  }
}
