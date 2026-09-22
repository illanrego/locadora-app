// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { readImmersiveEnabled, writeImmersiveEnabled } from '../src/locadora/immersive';

beforeEach(() => window.localStorage.clear());

describe('Locadora immersive preference', () => {
  it('defaults to the accessible 2D shelf and persists explicit enhancement use', () => {
    expect(readImmersiveEnabled()).toBe(false);
    writeImmersiveEnabled(true);
    expect(readImmersiveEnabled()).toBe(true);
  });
});
