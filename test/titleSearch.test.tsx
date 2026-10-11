// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TitleSearch } from '../src/components/TitleSearch';
import { searchTitles } from '../src/locadora/discovery';
import { normalizeTitleSearch } from '../src/locadora/titleSearch';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const movie = { id: 'tmdb:603', imdbId: 'tt0133093', type: 'movie', name: 'The Matrix', year: 1999,
  poster: 'https://image.tmdb.org/t/p/w500/matrix.jpg', background: 'https://image.tmdb.org/t/p/w780/matrix.jpg',
  description: 'A simulated world', imdbRating: '8.7', genres: ['Science Fiction'], source: 'tmdb-search' };

describe('title search', () => {
  it('bounds and validates untrusted result records', () => {
    expect(normalizeTitleSearch({ titles: 'bad' })).toBeNull();
    expect(normalizeTitleSearch({ titles: [
      movie,
      { ...movie, id: 'tmdb:604', type: 'series', name: 'Series', year: 'bad', poster: 'http://image.tmdb.org/t/p/w500/no.jpg', background: 'https://evil.invalid/no.jpg', imdbId: 'bad' },
      { ...movie, id: 'tmdb:0' },
      { ...movie, id: 'tmdb:603' },
      ...Array.from({ length: 15 }, (_, index) => ({ ...movie, id: `tmdb:${700 + index}` })),
    ] })?.map((title) => title.identity.canonicalKey)).toEqual([
      'movie:tmdb:603', 'series:tmdb:604', ...Array.from({ length: 8 }, (_, index) => `movie:tmdb:${700 + index}`),
    ]);
    const series = normalizeTitleSearch({ titles: [{ ...movie, id: 'tmdb:604', type: 'series', year: 'bad', poster: 'http://image.tmdb.org/t/p/w500/no.jpg', background: 'https://evil.invalid/no.jpg', imdbId: 'bad' }] })![0];
    expect(series).toMatchObject({ year: null, posterUrl: null, backdropUrl: null });
    expect(series.identity.externalIdentities).toEqual([{ namespace: 'tmdb', externalId: '604' }]);
  });

  it('builds the search route with a trimmed query and locale', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: 'ação & drama', titles: [movie] }) });
    vi.stubGlobal('fetch', fetch);
    const titles = await searchTitles('  ação & drama  ', 'pt-BR');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'ação & drama', locale: 'pt-BR' });
    expect(titles[0].identity.canonicalKey).toBe('movie:tmdb:603');
    await expect(searchTitles(' x ', 'pt-BR')).rejects.toThrow('2 a 80');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('submits, reports results, and opens inspection without a member action', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: 'matrix', titles: [movie] }) }));
    const inspect = vi.fn();
    const close = vi.fn();
    const user = userEvent.setup();
    render(<TitleSearch locale="pt-BR" onInspect={inspect} onOpenPerson={vi.fn()} onClose={close} />);
    expect(screen.getByRole('dialog', { name: 'Buscar título' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'matrix{Enter}');
    expect(await screen.findByRole('button', { name: 'Inspecionar The Matrix' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 título encontrado.');
    await user.click(screen.getByRole('button', { name: 'Inspecionar The Matrix' }));
    expect(close).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ canonicalKey: 'movie:tmdb:603' }) }));
  });

  it('shows empty and error states', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ query: 'none', titles: [] }) })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<TitleSearch locale="en-US" onInspect={vi.fn()} onOpenPerson={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'none{Enter}');
    expect(await screen.findByText('No titles found.')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'again{Enter}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not search titles.'));
  });
});
