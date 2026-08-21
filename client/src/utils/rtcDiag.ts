// Диагностика WebRTC-звонка: периодически опрашивает getStats() у
// RTCPeerConnection и пишет в console.* самые важные числа:
//   - selectedCandidatePair: тип локального/удалённого кандидата
//     (host/srflx/prflx/relay) и протокол (udp/tcp/tls). Это основной
//     ответ на вопрос «соединение пошло напрямую или через TURN».
//   - inbound-rtp audio:  packetsReceived, packetsLost, jitter, audioLevel
//   - outbound-rtp audio: packetsSent, bytesSent
//
// Юзер с проблемой «не слышу никого, рамка не загорается» откроет
// DevTools (Ctrl+Shift+I) → Console и сразу увидит, что не так:
//   • candidate=relay/udp + packetsReceived растёт → TURN работает.
//   • candidate=srflx/udp + packetsReceived=0 → симметричный NAT режет
//     RTP, нужен `forceTurnRelay`.
//   • candidate=host/udp + packetsReceived=0 → бага в локальном pipeline.
//
// Возвращает функцию-стоп для очистки. Безопасна к множественному вызову
// (сама себя останавливает на closed-pc и при ошибках).

type StopFn = () => void;

export function startRtcDiag(
  pc: RTCPeerConnection,
  label: string,
  intervalMs = 3000,
): StopFn {
  if (!pc || typeof pc.getStats !== 'function') return () => {};
  let stopped = false;
  let prevAudioIn = { packets: 0, bytes: 0 };
  let prevAudioOut = { packets: 0, bytes: 0 };

  const tag = `[rtc-diag ${label}]`;
  console.info(`${tag} started; iceTransportPolicy=`, pc.getConfiguration?.()?.iceTransportPolicy);

  const tick = async () => {
    if (stopped) return;
    if (pc.connectionState === 'closed') {
      stopped = true;
      console.info(`${tag} stopped (pc closed)`);
      return;
    }
    try {
      const stats = await pc.getStats();
      // WebRTC stats в lib.dom описаны как strict-интерфейсы без index-signature,
      // их нельзя присвоить в Record<string, unknown>. Работаем с ними
      // как с дак-тайпом — реальные поля от браузера отличаются от версии к версии.
      type Bag = Record<string, unknown>;
      let selectedPair: Bag | string | null = null;
      const candidates: Record<string, Bag> = {};
      let inAudio: Bag | null = null;
      let outAudio: Bag | null = null;
      stats.forEach((r) => {
        const rec = r as unknown as Bag;
        const type = rec.type as string;
        if (type === 'transport' && typeof rec.selectedCandidatePairId === 'string') {
          // selectedCandidatePairId был первым в стандарте; в современных
          // браузерах используется поле в самом transport-е.
          selectedPair = rec.selectedCandidatePairId;
        }
        if (type === 'candidate-pair' && rec.state === 'succeeded' && rec.nominated) {
          selectedPair = rec;
        }
        if (type === 'local-candidate' || type === 'remote-candidate') {
          candidates[rec.id as string] = rec;
        }
        if (type === 'inbound-rtp' && rec.kind === 'audio') inAudio = rec;
        if (type === 'outbound-rtp' && rec.kind === 'audio') outAudio = rec;
      });

      type PairInfo = {
        localType?: string;
        localProto?: string;
        localAddr?: string;
        remoteType?: string;
        remoteProto?: string;
        remoteAddr?: string;
        rtt?: number;
      };
      let pairInfo: PairInfo | null = null;
      if (selectedPair && typeof selectedPair === 'object') {
        const pair = selectedPair as Bag;
        const local = candidates[pair.localCandidateId as string];
        const remote = candidates[pair.remoteCandidateId as string];
        pairInfo = {
          localType: local?.candidateType as string | undefined,
          localProto: local?.protocol as string | undefined,
          localAddr: (local?.address as string | undefined) || (local?.ip as string | undefined),
          remoteType: remote?.candidateType as string | undefined,
          remoteProto: remote?.protocol as string | undefined,
          remoteAddr:
            (remote?.address as string | undefined) || (remote?.ip as string | undefined),
          rtt: pair.currentRoundTripTime as number | undefined,
        };
      }

      const inA: Bag | null = inAudio;
      const outA: Bag | null = outAudio;
      const inDelta = inA
        ? {
            dPackets: ((inA.packetsReceived as number) || 0) - prevAudioIn.packets,
            dBytes: ((inA.bytesReceived as number) || 0) - prevAudioIn.bytes,
            level: inA.audioLevel as number | undefined,
            jitter: inA.jitter as number | undefined,
            lost: inA.packetsLost as number | undefined,
          }
        : null;
      if (inA) {
        prevAudioIn = {
          packets: (inA.packetsReceived as number) || 0,
          bytes: (inA.bytesReceived as number) || 0,
        };
      }

      const outDelta = outA
        ? {
            dPackets: ((outA.packetsSent as number) || 0) - prevAudioOut.packets,
            dBytes: ((outA.bytesSent as number) || 0) - prevAudioOut.bytes,
          }
        : null;
      if (outA) {
        prevAudioOut = {
          packets: (outA.packetsSent as number) || 0,
          bytes: (outA.bytesSent as number) || 0,
        };
      }

      console.info(`${tag}`, {
        ice: pc.iceConnectionState,
        conn: pc.connectionState,
        pair: pairInfo,
        audioIn: inDelta,
        audioOut: outDelta,
      });
    } catch (e) {
      console.warn(`${tag} getStats failed`, e);
    }
  };

  const id = setInterval(tick, intervalMs);
  // Первый раз — сразу, чтобы юзер не ждал 3 сек на свой вопрос «что там».
  void tick();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(id);
    console.info(`${tag} stopped`);
  };
}

// Хелпер: построить конфиг RTCPeerConnection с учётом forceTurnRelay из
// настроек. На входе массив iceServers — что вернул сервер из /api/ice.
export function buildRtcConfig(
  iceServers: RTCIceServer[] | null | undefined,
  opts: { forceTurnRelay?: boolean } = {},
): RTCConfiguration {
  return {
    iceServers: iceServers && iceServers.length
      ? iceServers
      : [{ urls: 'stun:stun.l.google.com:19302' }],
    iceTransportPolicy: opts.forceTurnRelay ? 'relay' : 'all',
  };
}
