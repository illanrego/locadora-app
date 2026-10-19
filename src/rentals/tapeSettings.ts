/**
 * Local-only rented-tape settings used before the P5 settings UI exists.
 *
 * P4 persists the four operational keys it can enforce today: the master
 * switch, disk ceiling, seed ratio and peer port. The frozen upstream/share
 * keys are deliberately absent until the pinned engine exposes a real upload
 * limiter; writing a decorative bandwidth setting would be misleading.
 */
import { DEFAULT_TAPE_MAX_GB } from './tapeAdmission';
import { TAPE_GIBIBYTE } from './tapeManifest';

export const TAPE_SETTINGS_KEYS = {
  enabled: 'locadora.tapes.enabled',
  maxGb: 'locadora.tapes.maxGb',
  ratio: 'locadora.tapes.ratio',
  peerPort: 'locadora.tapes.peerPort',
} as const;

export interface TapeSettings {
  enabled: boolean;
  maxGb: number;
  ratio: number;
  peerPort: number;
}

export const DEFAULT_TAPE_SETTINGS: Readonly<TapeSettings> = Object.freeze({
  enabled: true,
  maxGb: DEFAULT_TAPE_MAX_GB,
  ratio: 0,
  peerPort: 6881,
});

const MAX_TAPE_GB = Math.floor(Number.MAX_SAFE_INTEGER / TAPE_GIBIBYTE);

type TapeSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): TapeSettingsStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function finiteNumber(value: string | null, fallback: number, maximum: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback;
}

function normalize(settings: Partial<TapeSettings>): TapeSettings {
  return {
    enabled: typeof settings.enabled === 'boolean' ? settings.enabled : DEFAULT_TAPE_SETTINGS.enabled,
    maxGb: typeof settings.maxGb === 'number'
      && Number.isFinite(settings.maxGb)
      && settings.maxGb >= 0
      && settings.maxGb <= MAX_TAPE_GB
      ? settings.maxGb
      : DEFAULT_TAPE_SETTINGS.maxGb,
    ratio: typeof settings.ratio === 'number'
      && Number.isFinite(settings.ratio)
      && settings.ratio >= 0
      && settings.ratio <= Number.MAX_SAFE_INTEGER
      ? settings.ratio
      : DEFAULT_TAPE_SETTINGS.ratio,
    peerPort: typeof settings.peerPort === 'number'
      && Number.isSafeInteger(settings.peerPort)
      && settings.peerPort >= 0
      && settings.peerPort <= 65_535
      ? settings.peerPort
      : DEFAULT_TAPE_SETTINGS.peerPort,
  };
}

export function readTapeSettings(storage: TapeSettingsStorage | null = browserStorage()): TapeSettings {
  if (!storage) return { ...DEFAULT_TAPE_SETTINGS };
  const enabled = storage.getItem(TAPE_SETTINGS_KEYS.enabled);
  return normalize({
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
    maxGb: finiteNumber(storage.getItem(TAPE_SETTINGS_KEYS.maxGb), DEFAULT_TAPE_SETTINGS.maxGb, MAX_TAPE_GB),
    ratio: finiteNumber(
      storage.getItem(TAPE_SETTINGS_KEYS.ratio),
      DEFAULT_TAPE_SETTINGS.ratio,
      Number.MAX_SAFE_INTEGER,
    ),
    peerPort: finiteNumber(
      storage.getItem(TAPE_SETTINGS_KEYS.peerPort),
      DEFAULT_TAPE_SETTINGS.peerPort,
      65_535,
    ),
  });
}

/** Writes a complete, normalized snapshot; invalid fields fall back safely. */
export function writeTapeSettings(
  settings: Partial<TapeSettings>,
  storage: TapeSettingsStorage | null = browserStorage(),
): TapeSettings {
  const accepted = normalize(settings);
  if (!storage) return accepted;
  storage.setItem(TAPE_SETTINGS_KEYS.enabled, String(accepted.enabled));
  storage.setItem(TAPE_SETTINGS_KEYS.maxGb, String(accepted.maxGb));
  storage.setItem(TAPE_SETTINGS_KEYS.ratio, String(accepted.ratio));
  storage.setItem(TAPE_SETTINGS_KEYS.peerPort, String(accepted.peerPort));
  return accepted;
}
