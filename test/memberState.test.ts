import { describe, expect, it } from 'vitest';
import { normalizeMemberHistoryPage, normalizeMemberState } from '../src/member/memberState';

describe('Locadora member-state normalization', () => {
  it('keeps bounded profile, rental, collection, and history fields', () => {
    const state = normalizeMemberState({
      profile: { userId: 'user-1', username: 'will', createdAt: '2025-01-02T00:00:00Z', secret: 'nope' },
      activeRental: {
        id: 'rental-1',
        items: [{ id: 'item-1', canonicalKey: 'movie:11', tmdbId: 11, type: 'movie', name: 'Tape One', year: 1999 }],
      },
      collections: {
        watch_later: [{ id: 'saved-1', canonicalKey: 'series:22', tmdbId: 22, type: 'series', name: 'Tape Two', year: 2001 }],
        favorite: [],
      },
      history: [{ id: 'past-1', canonicalKey: 'movie:33', tmdbId: 33, type: 'movie', name: 'Tape Three', watchedStatus: 'watched' }],
      historyHasMore: true,
    });

    expect(state.profile).toEqual({ userId: 'user-1', username: 'will', createdAt: '2025-01-02T00:00:00Z' });
    expect(state.activeRental?.items[0].name).toBe('Tape One');
    expect(state.collections.watchLater[0].canonicalKey).toBe('series:22');
    expect(state.history[0].watchedStatus).toBe('watched');
    expect(state.historyHasMore).toBe(true);
    expect(JSON.stringify(state)).not.toContain('secret');
  });

  it('drops malformed records instead of trusting Worker input', () => {
    const state = normalizeMemberState({
      profile: { userId: '', username: '<'.repeat(100) },
      activeRental: { id: 'rental', items: [{ type: 'movie', tmdbId: -1, name: 'Bad' }] },
      collections: { watch_later: 'not-an-array', favorite: [null, { type: 'book' }] },
      history: [{ type: 'movie', tmdbId: 1 }],
      historyHasMore: 'yes',
    });

    expect(state.profile).toBeNull();
    expect(state.activeRental).toBeNull();
    expect(state.collections.watchLater).toEqual([]);
    expect(state.collections.favorites).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.historyHasMore).toBe(false);
  });

  it('normalizes paginated history separately from initial state', () => {
    const page = normalizeMemberHistoryPage({
      history: [{ id: 'item-1', canonicalKey: 'movie:9', tmdbId: 9, type: 'movie', name: 'Tape Nine' }],
      hasMore: true,
      token: 'must-not-pass',
    });
    expect(page.history).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(JSON.stringify(page)).not.toContain('must-not-pass');
  });
});
