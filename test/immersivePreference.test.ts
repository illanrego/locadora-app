// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { readImmersiveEnabled, writeImmersiveEnabled } from '../src/locadora/immersive';

beforeEach(() => window.localStorage.clear());

describe('Locadora immersive preference', () => {
  it('starts on the immersive shelf and remembers an explicit opt-out', () => {
    expect(readImmersiveEnabled()).toBe(true);
    writeImmersiveEnabled(false);
    expect(readImmersiveEnabled()).toBe(false);
    writeImmersiveEnabled(true);
    expect(readImmersiveEnabled()).toBe(true);
  });
});
