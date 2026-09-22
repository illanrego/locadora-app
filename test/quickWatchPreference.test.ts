// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { readQuickWatchEnabled, writeQuickWatchEnabled } from '../src/media/quickWatchPreference';

beforeEach(() => window.localStorage.clear());

describe('Quick Watch preference', () => {
  it('defaults on and persists only the autoplay preference', () => {
    expect(readQuickWatchEnabled()).toBe(true);
    writeQuickWatchEnabled(false);
    expect(readQuickWatchEnabled()).toBe(false);
    writeQuickWatchEnabled(true);
    expect(readQuickWatchEnabled()).toBe(true);
  });
});
