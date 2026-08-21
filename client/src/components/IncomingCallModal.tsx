import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import Avatar from './Avatar';
import { getAvatarUrl, getDisplayName, hasCustomDisplayName } from '../utils/user';
import {
  modalVariants,
  overlayVariants,
  pulseRingTransition,
  reducedVariants,
} from '../utils/motion';

export default function IncomingCallModal({ call }) {
  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;
  const incoming = call.state === 'incoming';

  return (
    <AnimatePresence>
      {incoming &&
        (() => {
          const { peer, withVideo, accept, reject } = call;
          const name = getDisplayName(peer);
          const avatarUrl = getAvatarUrl(peer);
          return (
            <motion.div
              key="incoming-call"
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-6"
              variants={overlayV}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <motion.div
                className="card w-full max-w-sm p-6 flex flex-col items-center text-center"
                variants={panelV}
              >
                <div className="relative rounded-full mb-4">
                  {!reduce && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border-2 border-accent/65 pointer-events-none"
                      initial={{ opacity: 0.55, scale: 1 }}
                      animate={{ opacity: [0.55, 0, 0], scale: [1, 1.28, 1.28] }}
                      transition={pulseRingTransition}
                      style={{ willChange: 'transform, opacity' }}
                    />
                  )}
                  <Avatar name={name} src={avatarUrl} size={88} />
                </div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Входящий {withVideo ? 'видео-звонок' : 'звонок'}
                </div>
                <div className="text-xl font-semibold">{name}</div>
                {hasCustomDisplayName(peer) && (
                  <div className="text-sm text-slate-500 mb-6">@{peer.username}</div>
                )}
                {!hasCustomDisplayName(peer) && <div className="mb-6" />}

                <div className="flex items-center justify-center gap-8">
                  <button
                    onClick={reject}
                    className="btn-icon bg-danger hover:bg-danger-hover text-white"
                    style={{ width: 56, height: 56 }}
                    title="Отклонить"
                  >
                    <PhoneOff size={22} />
                  </button>
                  <button
                    onClick={accept}
                    className="btn-icon bg-success hover:bg-green-500 text-white"
                    style={{ width: 56, height: 56 }}
                    title="Принять"
                  >
                    {withVideo ? <Video size={22} /> : <Phone size={22} />}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
    </AnimatePresence>
  );
}
