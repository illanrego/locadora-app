// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryTitle } from '../src/domain/content';
import css from '../src/styles.css?raw';

const discovery = vi.hoisted(() => ({
  loadShelf: vi.fn(),
  loadTitleDetails: vi.fn(),
}));
const progressCache = vi.hoisted(() => ({ readAllSeriesProgress: vi.fn(), readLocalSeriesEpisodes: vi.fn() }));

vi.mock('../src/locadora/discovery', () => discovery);
// The shelf owner is the only caller; a card must never open its own read.
vi.mock('../src/locadora/localCache', () => progressCache);

import App from '../src/App';

function title(id: number, name: string): DiscoveryTitle {
  return {
    identity: {
      canonicalKey: `movie:tmdb:${id}`,
      type: 'movie',
      externalIdentities: [{ namespace: 'tmdb', externalId: String(id) }],
    },
    name,
    year: 1999,
    genres: ['Action'],
    description: '',
    posterUrl: `https://images.example.invalid/${id}.jpg`,
    backdropUrl: null,
    imdbRating: null,
    runtimeMinutes: null,
    certificationBR: null,
    director: [],
    writer: [],
    cast: [],
    providers: [],
  };
}

function seriesTitle(id: number, name: string): DiscoveryTitle {
  const series = title(id, name);
  const imdbId = `tt${String(id).padStart(7, '0')}`;
  return {
    ...series,
    identity: {
      canonicalKey: `series:tmdb:${id}`,
      type: 'series',
      externalIdentities: [
        { namespace: 'tmdb', externalId: String(id) },
        { namespace: 'imdb', externalId: imdbId },
      ],
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  progressCache.readAllSeriesProgress.mockResolvedValue([]);
  progressCache.readLocalSeriesEpisodes.mockResolvedValue(null);
  discovery.loadShelf.mockImplementation(async ({ stand }: { stand: number }) => stand === 0
    ? { titles: [title(1, 'First Stand Tape')], hasNextStand: true, source: 'public-api' }
    : { titles: [title(2, 'Second Stand Tape')], hasNextStand: false, source: 'public-api' });
  discovery.loadTitleDetails.mockImplementation(async (value: DiscoveryTitle) => value);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('physical shelf pagination', () => {
  it('appends each catalogue page as a separate stand with cached cover loading', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const firstStand = await screen.findByRole('region', { name: 'Estante 1' });
    expect(within(firstStand).getByRole('button', { name: /First Stand Tape/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carregar outra estante' }));

    const secondStand = await screen.findByRole('region', { name: 'Estante 2' });
    expect(within(firstStand).getByRole('button', { name: /First Stand Tape/i })).toBeInTheDocument();
    expect(within(secondStand).getByRole('button', { name: /Second Stand Tape/i })).toBeInTheDocument();
    expect(container.querySelectorAll('.shelf')).toHaveLength(2);
    expect(secondStand.querySelector('img')).toHaveAttribute('src', 'https://images.example.invalid/2.jpg');
    expect(secondStand.querySelector('img')).toHaveAttribute('decoding', 'async');
  });
});

describe('series watched state on the shelf', () => {
  it('marks only the series case that has local progress and reads progress once per shelf', async () => {
    discovery.loadShelf.mockImplementation(async () => ({
      titles: [title(1, 'Plain movie'), seriesTitle(7, 'Fixture series'), title(2, 'Other movie')],
      hasNextStand: false,
      source: 'public-api',
    }));
    progressCache.readAllSeriesProgress.mockResolvedValue([
      { seriesId: 'tt0000007', season: 1, episode: 2, watched: { '1:1': 'a', '1:2': 'b' }, updatedAt: '2026-10-19T00:00:00.000Z' },
    ]);

    render(<App />);

    const markers = await screen.findAllByRole('img', { name: /assistidos$/ });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAccessibleName('Fixture series: 2 episódios assistidos');
    expect(progressCache.readAllSeriesProgress).toHaveBeenCalledTimes(1);

    // The marker is a sibling of the tape button: the inspect name and the
    // single tab stop of the case are untouched.
    const seriesButton = screen.getByRole('button', { name: 'Inspecionar Fixture series, 1999' });
    expect(seriesButton.closest('.vhs-item')?.contains(markers[0])).toBe(true);
    expect(markers[0].closest('button')).toBeNull();
    expect(markers[0]).not.toHaveAttribute('tabindex');
  });

  it('shows nothing at all for a series without local progress', async () => {
    discovery.loadShelf.mockImplementation(async () => ({
      titles: [seriesTitle(7, 'Fixture series')],
      hasNextStand: false,
      source: 'public-api',
    }));

    const { container } = render(<App />);

    await screen.findByRole('button', { name: 'Inspecionar Fixture series, 1999' });
    expect(container.querySelector('.case-progress')).toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('adds the next episode label from the cached list to the marker name', async () => {
    discovery.loadShelf.mockImplementation(async () => ({
      titles: [seriesTitle(7, 'Fixture series')],
      hasNextStand: false,
      source: 'public-api',
    }));
    progressCache.readAllSeriesProgress.mockResolvedValue([
      { seriesId: 'tt0000007', season: 1, episode: 2, watched: { '1:1': 'a', '1:2': 'b' }, updatedAt: '2026-10-19T00:00:00.000Z' },
    ]);
    progressCache.readLocalSeriesEpisodes.mockResolvedValue({
      seasons: [{ season: 1, episodes: [
        { season: 1, episode: 1, name: 'Pilot' },
        { season: 1, episode: 2 },
        { season: 1, episode: 3, name: 'Third' },
      ] }],
    });

    render(<App />);

    expect(await screen.findByRole('img', { name: 'Fixture series: 2 episódios assistidos, próximo T01E03' }))
      .toBeInTheDocument();
    expect(progressCache.readLocalSeriesEpisodes).toHaveBeenCalledWith('tt0000007');
  });

  it('counts a single watched episode in English too', async () => {
    discovery.loadShelf.mockImplementation(async () => ({
      titles: [seriesTitle(7, 'Fixture series')],
      hasNextStand: false,
      source: 'public-api',
    }));
    progressCache.readAllSeriesProgress.mockResolvedValue([
      { seriesId: 'tt0000007', season: 1, episode: 1, watched: { '1:1': 'a' }, updatedAt: '2026-10-19T00:00:00.000Z' },
    ]);

    render(<App />);
    await screen.findByRole('button', { name: 'Inspecionar Fixture series, 1999' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajustes' }));
    await user.click(screen.getByRole('button', { name: 'English' }));

    expect(await screen.findByRole('img', { name: 'Fixture series: 1 episode watched' })).toBeInTheDocument();
  });
});

describe('episode picker placement', () => {
  it('leaves the 2D placement alone and anchors the immersive picker below the header actions', () => {
    expect(css).toContain('.tape-episodes { position: fixed; z-index: 5; top: 1rem; right: clamp(4.5rem, 7vw, 6rem);');
    const immersive = css.indexOf('.is-immersive .tape-episodes {');
    expect(immersive).toBeGreaterThan(-1);
    expect(css.slice(immersive, immersive + 120)).toContain('top: 4.6rem');
    expect(css.slice(immersive, immersive + 120)).toContain('max-height: min(calc(50vh - 7rem), 520px)');
  });
});
