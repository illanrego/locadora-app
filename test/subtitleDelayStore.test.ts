// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { readSubtitleDelay, writeSubtitleDelay } from '../src/media/subtitleDelayStore';

beforeEach(() => window.localStorage.clear());

describe('release-scoped subtitle delay storage', () => {
  it('does not leak delay between releases or tracks', () => {
    writeSubtitleDelay('release-a', 'pt', 1_500);
    expect(readSubtitleDelay('release-a', 'pt')).toBe(1_500);
    expect(readSubtitleDelay('release-b', 'pt')).toBe(0);
    expect(readSubtitleDelay('release-a', 'en')).toBe(0);
  });

  it('bounds corrupted and excessive values', () => {
    writeSubtitleDelay('release', 'pt', 900_000);
    expect(readSubtitleDelay('release', 'pt')).toBe(600_000);
  });
});
