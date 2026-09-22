// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_TITLES } from '../src/locadora/fixture';
import { hasLocalSavedTitle, readLocalSavedCollections, setLocalSavedTitle, writeLocalSavedCollections } from '../src/member/localSaved';

beforeEach(() => window.localStorage.clear());

describe('anonymous saved-title storage', () => {
  it('persists only normalized title metadata per collection', () => {
    const title = FIXTURE_TITLES[0];
    const next = setLocalSavedTitle(readLocalSavedCollections(), title, 'watch_later', true);
    writeLocalSavedCollections(next);
    const restored = readLocalSavedCollections();

    expect(hasLocalSavedTitle(restored, title, 'watch_later')).toBe(true);
    expect(hasLocalSavedTitle(restored, title, 'favorite')).toBe(false);
    expect(restored.watch_later[0].name).toBe(title.name);
  });

  it('drops malformed local data', () => {
    window.localStorage.setItem('wills-locadora.saved.v1', JSON.stringify({ watch_later: [{ type: 'movie', tmdbId: -1 }], favorite: 'bad' }));
    expect(readLocalSavedCollections()).toEqual({ watch_later: [], favorite: [] });
  });
});
