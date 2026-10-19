/**
 * Rented-tape disk admission (§9, §18.3, §20 settings keys).
 *
 * The tape engine's own budget is unlimited, so eviction can never remove a
 * rented tape. The app owns the ceiling, and it is the smaller of two numbers:
 * the user's ceiling (`locadora.tapes.maxGb`, default 6, `0` = no ceiling) and
 * the free space minus a 2 GiB reserve. Free space may be unknown — until a
 * native `statvfs` call lands with the settings surface, `freeBytes` is `null`
 * and admission decides by the ceiling alone.
 *
 * A refusal is pure: this module never sees a mutable manifest and never removes,
 * rewrites or shrinks a tape. The rental survives, the tape stays stream-only.
 */
import { TAPE_GIBIBYTE, MAX_TAPES, totalBytes, type TapeState } from './tapeManifest';

/** `locadora.tapes.maxGb` default (§20). */
export const DEFAULT_TAPE_MAX_GB = 6;
/** Free space kept free for the rest of the machine (§18.3). */
export const TAPE_RESERVE_BYTES = 2 * TAPE_GIBIBYTE;

export type TapeRefusalReason = 'cap-exceeded' | 'count-exceeded' | 'unknown-size' | 'space-exceeded';

export interface TapeAdmissionCaps {
  /** `locadora.tapes.maxGb`; `0` disables the ceiling, absent means the default. */
  maxGb?: number;
  /** `locadora.tapes.maxCount`; `0` follows the rental limit, absent means `0`. */
  maxCount?: number;
  /** The server-side rental limit (D-020); absent means the hard maximum of ten. */
  rentalLimit?: number;
}

/** Structural input so a manifest row can be passed without narrowing it first. */
export interface TapeAdmissionTape {
  state: TapeState;
  sizeBytes: number;
}

export interface TapeAdmissionRequest {
  sizeBytes: number;
  tapes: readonly TapeAdmissionTape[];
  caps?: TapeAdmissionCaps;
  /** Unknown free space is `null` or absent; admission then uses the ceiling only. */
  freeBytes?: number | null;
}

export type TapeAdmission = { allowed: true } | { allowed: false; reason: TapeRefusalReason };

/**
 * The user's ceiling in bytes, or `null` when there is none. A corrupt setting
 * falls back to the default instead of silently removing the ceiling: the safe
 * failure for a disk limit is to keep limiting.
 */
export function tapeCeilingBytes(caps: TapeAdmissionCaps = {}): number | null {
  const maxGb = caps.maxGb;
  const value = typeof maxGb === 'number' && Number.isFinite(maxGb) && maxGb >= 0
    ? maxGb
    : DEFAULT_TAPE_MAX_GB;
  return value === 0 ? null : value * TAPE_GIBIBYTE;
}

/** Free space left for tapes after the reserve, or `null` when it is unknown. */
export function availableTapeBytes(freeBytes: number | null | undefined): number | null {
  if (typeof freeBytes !== 'number' || !Number.isFinite(freeBytes)) return null;
  return freeBytes - TAPE_RESERVE_BYTES;
}

/**
 * How many tapes may be kept: the rental limit by default, and a separate cap can
 * never exceed it or the store's own ten-row ceiling.
 */
export function tapeCountCap(caps: TapeAdmissionCaps = {}): number {
  const rentalLimit = clampCount(caps.rentalLimit, MAX_TAPES);
  const requested = caps.maxCount;
  const cap = typeof requested === 'number' && requested > 0 ? clampCount(requested, rentalLimit) : rentalLimit;
  return Math.max(0, Math.min(cap, rentalLimit, MAX_TAPES));
}

function clampCount(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fallback;
  return value;
}

function saturatedAdd(left: number, right: number): number {
  const sum = left + right;
  return sum > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : sum;
}

/**
 * Decides whether one more tape may be downloaded.
 *
 * Checks run in the order a person would ask them: is the size known, does this
 * tape fit under the ceiling, does it fit on the disk right now, and is there a
 * slot in the shelf. `returned` rows do not occupy a slot; every other row does,
 * including a `failed` one, because a failed tape may still hold partial pieces.
 */
export function admitTape(request: TapeAdmissionRequest): TapeAdmission {
  const { sizeBytes } = request;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return { allowed: false, reason: 'unknown-size' };
  }

  const kept = request.tapes.filter((tape) => tape.state !== 'returned');

  const ceiling = tapeCeilingBytes(request.caps);
  if (ceiling !== null && saturatedAdd(totalBytes(kept), sizeBytes) > ceiling) {
    return { allowed: false, reason: 'cap-exceeded' };
  }

  const available = availableTapeBytes(request.freeBytes);
  if (available !== null && sizeBytes > available) {
    return { allowed: false, reason: 'space-exceeded' };
  }

  if (kept.length + 1 > tapeCountCap(request.caps)) {
    return { allowed: false, reason: 'count-exceeded' };
  }

  return { allowed: true };
}
