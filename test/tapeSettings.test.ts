// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TAPE_SETTINGS,
  TAPE_SETTINGS_KEYS,
  readTapeSettings,
  writeTapeSettings,
} from '../src/rentals/tapeSettings';

beforeEach(() => window.localStorage.clear());

describe('local rented-tape settings', () => {
  it('uses the frozen defaults when storage is empty or invalid', () => {
    expect(readTapeSettings()).toEqual(DEFAULT_TAPE_SETTINGS);
    window.localStorage.setItem(TAPE_SETTINGS_KEYS.enabled, 'maybe');
    window.localStorage.setItem(TAPE_SETTINGS_KEYS.maxGb, '-1');
    window.localStorage.setItem(TAPE_SETTINGS_KEYS.ratio, 'NaN');
    window.localStorage.setItem(TAPE_SETTINGS_KEYS.peerPort, '65536');
    expect(readTapeSettings()).toEqual(DEFAULT_TAPE_SETTINGS);
  });

  it('round-trips valid zero and non-default spawn values', () => {
    expect(writeTapeSettings({ enabled: false, maxGb: 0, ratio: 1.5, peerPort: 0 })).toEqual({
      enabled: false,
      maxGb: 0,
      ratio: 1.5,
      peerPort: 0,
    });
    expect(readTapeSettings()).toEqual({ enabled: false, maxGb: 0, ratio: 1.5, peerPort: 0 });
    expect(Object.keys(window.localStorage).sort()).toEqual(Object.values(TAPE_SETTINGS_KEYS).sort());
  });

  it('normalizes invalid writes instead of persisting unsafe values', () => {
    const accepted = writeTapeSettings({
      enabled: 'yes' as unknown as boolean,
      maxGb: Number.POSITIVE_INFINITY,
      ratio: -1,
      peerPort: 3.5,
    });
    expect(accepted).toEqual(DEFAULT_TAPE_SETTINGS);
    expect(readTapeSettings()).toEqual(DEFAULT_TAPE_SETTINGS);
  });
});
