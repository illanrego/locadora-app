import { subtitleDelayFingerprint } from './subtitles';

const PREFIX = 'locadora:subtitle-delay:v1:';
const MAXIMUM_DELAY_MS = 600_000;

function key(videoFingerprint: string, trackId: string): string {
  return `${PREFIX}${subtitleDelayFingerprint(videoFingerprint, { id: trackId })}`;
}

export function readSubtitleDelay(videoFingerprint: string, trackId: string): number {
  try {
    const value = Number(window.localStorage.getItem(key(videoFingerprint, trackId)));
    return Number.isFinite(value) && Math.abs(value) <= MAXIMUM_DELAY_MS ? Math.round(value) : 0;
  } catch {
    return 0;
  }
}

export function writeSubtitleDelay(videoFingerprint: string, trackId: string, milliseconds: number): void {
  if (!Number.isFinite(milliseconds)) return;
  const bounded = Math.max(-MAXIMUM_DELAY_MS, Math.min(MAXIMUM_DELAY_MS, Math.round(milliseconds)));
  try {
    window.localStorage.setItem(key(videoFingerprint, trackId), String(bounded));
  } catch {
    // Playback remains usable when local persistence is unavailable.
  }
}
