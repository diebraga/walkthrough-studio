export const ANNEAL_DURATION_MS = 2200;

export function easeInOutCubic(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function openingAnnealProgress(elapsedMs: number, durationMs = ANNEAL_DURATION_MS) {
  if (durationMs <= 0) return 0;
  return 1 - easeInOutCubic(elapsedMs / durationMs);
}
