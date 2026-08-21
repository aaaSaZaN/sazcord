/// <reference types="vite/client" />

// Подставляется Vite на сборке из client/package.json (см. define в
// vite.config.ts). В тестах значения нет — utils/updates.ts это учитывает.
declare const __APP_VERSION__: string;

interface Window {
  webkitAudioContext?: typeof AudioContext;
}

interface RTCPeerConnection {
  __audioSender?: RTCRtpSender;
  __videoSender?: RTCRtpSender;
}
