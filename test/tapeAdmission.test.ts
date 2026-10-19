import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAPE_MAX_GB,
  TAPE_RESERVE_BYTES,
  admitTape,
  availableTapeBytes,
  tapeCeilingBytes,
  tapeCountCap,
  type TapeAdmissionTape,
} from '../src/rentals/tapeAdmission';
import { TAPE_GIBIBYTE, type TapeState } from '../src/rentals/tapeManifest';

const GIB = TAPE_GIBIBYTE;

function kept(count: number, sizeBytes = 0, state: TapeState = 'ready'): TapeAdmissionTape[] {
  return Array.from({ length: count }, () => ({ state, sizeBytes }));
}

describe('tape admission by the GB ceiling', () => {
  it('defaults the ceiling to 6 GB and lets a tape sit exactly on it', () => {
    expect(tapeCeilingBytes()).toBe(6 * GIB);
    expect(DEFAULT_TAPE_MAX_GB).toBe(6);

    expect(admitTape({ sizeBytes: 6 * GIB, tapes: [] })).toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: 6 * GIB - 1, tapes: [] })).toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: 6 * GIB + 1, tapes: [] })).toEqual({ allowed: false, reason: 'cap-exceeded' });
  });

  it('measures the ceiling against what is already kept', () => {
    const existing = kept(1, 1 * GIB);
    expect(admitTape({ sizeBytes: 5 * GIB, tapes: existing })).toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: 5 * GIB + 1, tapes: existing })).toEqual({ allowed: false, reason: 'cap-exceeded' });
  });

  it('treats maxGb 0 as no ceiling and a corrupt maxGb as the default', () => {
    expect(tapeCeilingBytes({ maxGb: 0 })).toBeNull();
    expect(admitTape({ sizeBytes: 500 * GIB, tapes: kept(9, 500 * GIB), caps: { maxGb: 0 } })).toEqual({ allowed: true });
    expect(tapeCeilingBytes({ maxGb: Number.NaN })).toBe(6 * GIB);
    expect(tapeCeilingBytes({ maxGb: -1 })).toBe(6 * GIB);
    expect(admitTape({ sizeBytes: 7 * GIB, tapes: [], caps: { maxGb: Number.NaN } }))
      .toEqual({ allowed: false, reason: 'cap-exceeded' });
  });
});

describe('tape admission by the free-space budget', () => {
  it('admits by the ceiling alone when free space is unknown', () => {
    expect(availableTapeBytes(null)).toBeNull();
    expect(availableTapeBytes(undefined)).toBeNull();
    expect(availableTapeBytes(Number.NaN)).toBeNull();
    expect(admitTape({ sizeBytes: 5 * GIB, tapes: [], freeBytes: null })).toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: 5 * GIB, tapes: [] })).toEqual({ allowed: true });
  });

  it('refuses when the free space minus the 2 GiB reserve is smaller than the tape', () => {
    expect(TAPE_RESERVE_BYTES).toBe(2 * GIB);
    expect(availableTapeBytes(3 * GIB)).toBe(1 * GIB);
    expect(admitTape({ sizeBytes: 5 * GIB, tapes: [], freeBytes: 3 * GIB }))
      .toEqual({ allowed: false, reason: 'space-exceeded' });
    expect(admitTape({ sizeBytes: 1 * GIB, tapes: [], freeBytes: 3 * GIB })).toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: 1 * GIB + 1, tapes: [], freeBytes: 3 * GIB }))
      .toEqual({ allowed: false, reason: 'space-exceeded' });
  });

  it('uses the smaller of the ceiling remainder and the space budget', () => {
    // Space is generous, the ceiling is one byte short.
    expect(admitTape({ sizeBytes: 6 * GIB, tapes: [], freeBytes: 100 * GIB }))
      .toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: 6 * GIB + 1, tapes: [], freeBytes: 100 * GIB }))
      .toEqual({ allowed: false, reason: 'cap-exceeded' });
    // The ceiling is generous, the space is short.
    expect(admitTape({ sizeBytes: 6 * GIB, tapes: [], freeBytes: 3 * GIB }))
      .toEqual({ allowed: false, reason: 'space-exceeded' });
    // A disk with no room left after the reserve refuses everything.
    expect(admitTape({ sizeBytes: 1, tapes: [], freeBytes: 2 * GIB }))
      .toEqual({ allowed: false, reason: 'space-exceeded' });
  });
});

describe('tape admission by the count cap', () => {
  it('follows the rental limit when maxCount is 0', () => {
    expect(tapeCountCap({ rentalLimit: 3 })).toBe(3);
    expect(tapeCountCap({ rentalLimit: 3, maxCount: 0 })).toBe(3);
    expect(admitTape({ sizeBytes: GIB, tapes: kept(2), caps: { rentalLimit: 3 } })).toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: GIB, tapes: kept(3), caps: { rentalLimit: 3 } }))
      .toEqual({ allowed: false, reason: 'count-exceeded' });
  });

  it('never lets a separate cap exceed the rental limit or the ten-row ceiling', () => {
    expect(tapeCountCap({ rentalLimit: 3, maxCount: 5 })).toBe(3);
    expect(tapeCountCap({ rentalLimit: 10, maxCount: 12 })).toBe(10);
    expect(tapeCountCap({ maxCount: 2 })).toBe(2);
    expect(admitTape({ sizeBytes: GIB, tapes: kept(2), caps: { rentalLimit: 10, maxCount: 2 } }))
      .toEqual({ allowed: false, reason: 'count-exceeded' });
  });

  it('does not let a returned tape occupy a slot', () => {
    expect(admitTape({ sizeBytes: GIB, tapes: kept(3, GIB, 'returned'), caps: { rentalLimit: 3 } }))
      .toEqual({ allowed: true });
    expect(admitTape({ sizeBytes: GIB, tapes: kept(3), caps: { rentalLimit: 3 } }))
      .toEqual({ allowed: false, reason: 'count-exceeded' });
  });
});

describe('tape admission refusals', () => {
  it('refuses an unknown size before judging anything else', () => {
    for (const sizeBytes of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(admitTape({ sizeBytes, tapes: kept(10), caps: { rentalLimit: 1 }, freeBytes: 0 }))
        .toEqual({ allowed: false, reason: 'unknown-size' });
    }
  });

  it('never mutates the manifest or the caps it was given', () => {
    const tapes = Object.freeze(kept(2, GIB).map((tape) => Object.freeze(tape)));
    const caps = Object.freeze({ maxGb: 6, maxCount: 2, rentalLimit: 2 });
    expect(admitTape({ sizeBytes: GIB, tapes, caps, freeBytes: 4 * GIB }))
      .toEqual({ allowed: false, reason: 'count-exceeded' });
    expect(tapes).toHaveLength(2);
    expect(tapes.every((tape) => tape.state === 'ready' && tape.sizeBytes === GIB)).toBe(true);
    expect(caps).toEqual({ maxGb: 6, maxCount: 2, rentalLimit: 2 });
  });
});
