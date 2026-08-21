import type { Transition, Variant, Variants } from 'motion/react';

export const easeOutCubic: [number, number, number, number] = [0.215, 0.61, 0.355, 1];
export const easeOutQuart: [number, number, number, number] = [0.165, 0.84, 0.44, 1];
export const easeInOutCubic: [number, number, number, number] = [0.645, 0.045, 0.355, 1];

export const duration = {
  micro: 0.12,
  fast: 0.15,
  enter: 0.2,
  exit: 0.16,
  pulse: 1.6,
} as const;

export const tEnter: Transition = { duration: duration.enter, ease: easeOutCubic };
export const tExit: Transition = { duration: duration.exit, ease: easeOutCubic };
export const tFast: Transition = { duration: duration.fast, ease: easeOutCubic };

export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: tEnter },
  exit: { opacity: 0, transition: tExit },
};

export const modalVariants: Variants = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: tEnter },
  exit: { opacity: 0, y: 4, scale: 0.98, transition: tExit },
};

export const toastVariants: Variants = {
  initial: { opacity: 0, y: -8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: easeOutCubic } },
  exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.14, ease: easeOutCubic } },
};

export const menuVariants: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.14, ease: easeOutCubic } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.1, ease: easeOutCubic } },
};

export const pulseRingTransition: Transition = {
  duration: duration.pulse,
  ease: 'linear',
  repeat: Infinity,
};

export function reducedVariants(v: Variants): Variants {
  const animate = (v.animate ?? {}) as Variant;
  return {
    initial: animate,
    animate,
    exit: animate,
  };
}
