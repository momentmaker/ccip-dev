import { kindColor, type CometKind } from './frame';

export const COIN_CATCH_MS = 700;

const CENTER = 'translate(-50%, -50%)';
const RIM = '0 0 0 1px rgba(255, 255, 255, 0.18)';

interface Animatable {
  getAnimations(): { cancel(): void }[];
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): unknown;
}

export function coinCatchKeyframes(kind: CometKind): Keyframe[] {
  const rgb = kindColor(kind)
    .map((v) => Math.round(v * 255))
    .join(', ');
  const glow = (halo: number, haloAlpha: number, ripple: number, rippleAlpha: number) =>
    `${RIM}, 0 0 ${halo}px ${halo / 3}px rgba(${rgb}, ${haloAlpha}), 0 0 0 ${ripple}px rgba(${rgb}, ${rippleAlpha})`;
  return [
    { offset: 0, transform: `${CENTER} scale(1)`, boxShadow: glow(0, 0, 0, 0.7), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    { offset: 0.22, transform: `${CENTER} scale(1.15)`, boxShadow: glow(22, 0.9, 2, 0.7), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    { offset: 1, transform: `${CENTER} scale(1)`, boxShadow: glow(0, 0, 18, 0) },
  ];
}

export function catchCoin(coin: Animatable | undefined, kind: CometKind): void {
  if (!coin) return;
  for (const running of coin.getAnimations()) running.cancel();
  coin.animate(coinCatchKeyframes(kind), { duration: COIN_CATCH_MS });
}
