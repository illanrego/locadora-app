// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';

const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  fetcher: vi.fn(),
  readEpisodes: vi.fn(),
  cacheEpisodes: vi.fn(),
  readProgress: vi.fn(),
  setWatched: vi.fn(),
  clearProgress: vi.fn(),
}));
vi.mock('../src/platform/nativeBridge', () => ({
  readMediaConfiguration: mocks.configuration,
  fetchConfiguredAddonResource: mocks.fetcher,
}));
vi.mock('../src/locadora/localCache', () => ({
  readLocalSeriesEpisodes: mocks.readEpisodes,
  cacheSeriesEpisodes: mocks.cacheEpisodes,
  readSeriesProgress: mocks.readProgress,
  setEpisodeWatched: mocks.setWatched,
  clearSeriesProgress: mocks.clearProgress,
}));
import { SeriesEpisodePicker } from '../src/components/SeriesEpisodePicker';

const title = normalizeDiscoveryTitle({ id: 1, imdbId: 'tt0182576', type: 'series', name: 'Fixture series', year: 1999 })!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configuration.mockResolvedValue([
    { id: 'meta', name: 'Metadata', resources: ['meta'], supportsStreams: false, supportsSubtitles: false },
  ]);
  mocks.readEpisodes.mockResolvedValue(null);
  mocks.cacheEpisodes.mockResolvedValue(undefined);
  mocks.readProgress.mockResolvedValue(null);
  mocks.setWatched.mockResolvedValue(null);
  mocks.clearProgress.mockResolvedValue(undefined);
  mocks.fetcher.mockResolvedValue({ meta: { videos: [
    { season: 0, episode: 1, name: 'Special' },
    { season: 16, episode: 5, name: 'The chosen one' },
    { season: 16, episode: 6 },
    { season: 17, episode: 1, name: 'A new year' },
  ] } });
});
afterEach(cleanup);

describe('series episode picker', () => {
  it('shows normal seasons, names and fixed labels, then selects an episode', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SeriesEpisodePicker title={title} locale="pt-BR" canWatch onSelect={onSelect} />);

    expect(await screen.findByRole('option', { name: 'Temporada 16' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Temporada 0' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'T16E05 · The chosen one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'T16E06' })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Temporada' }), '17');
    await user.click(screen.getByRole('button', { name: 'T17E01 · A new year' }));
    expect(onSelect).toHaveBeenCalledWith({ season: 17, episode: 1, name: 'A new year' });
    await waitFor(() => expect(mocks.fetcher).toHaveBeenCalledWith({
      addonId: 'meta', resource: 'meta', contentType: 'series', id: 'tt0182576',
    }));
  });

  it('starts the first known episode when there is no progress', async () => {
    mocks.fetcher.mockResolvedValue({ meta: { videos: [
      { season: 1, episode: 1, name: 'Pilot' },
      { season: 1, episode: 2 },
    ] } });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SeriesEpisodePicker title={title} locale="en-US" canWatch onSelect={onSelect} />);

    await user.click(await screen.findByRole('button', { name: 'Start T01E01' }));
    expect(onSelect).toHaveBeenCalledWith({ season: 1, episode: 1, name: 'Pilot' });
  });

  it('continues across a season boundary and manually toggles the same progress record', async () => {
    const timestamp = '2026-10-18T12:00:00.000Z';
    mocks.readProgress.mockResolvedValue({
      seriesId: 'tt0182576', season: 16, episode: 6,
      watched: { '16:5': timestamp, '16:6': timestamp }, updatedAt: timestamp,
    });
    mocks.setWatched.mockResolvedValue({
      seriesId: 'tt0182576', season: 16, episode: 5,
      watched: { '16:6': timestamp }, updatedAt: timestamp,
    });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SeriesEpisodePicker title={title} locale="pt-BR" canWatch onSelect={onSelect} />);

    await user.click(await screen.findByRole('button', { name: 'Continuar T17E01' }));
    expect(onSelect).toHaveBeenCalledWith({ season: 17, episode: 1, name: 'A new year' });
    await user.click(screen.getByRole('button', { name: 'Assistido T16E05' }));
    expect(mocks.setWatched).toHaveBeenCalledWith(
      'tt0182576', { season: 16, episode: 5, name: 'The chosen one' }, false,
    );
    expect(await screen.findByRole('button', { name: 'Marcar como assistido T16E05' })).toBeInTheDocument();
  });

  it('forgets this series progress only, and only on request', async () => {
    const timestamp = '2026-10-18T12:00:00.000Z';
    mocks.readProgress.mockResolvedValue({
      seriesId: 'tt0182576', season: 16, episode: 5,
      watched: { '16:5': timestamp }, updatedAt: timestamp,
    });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SeriesEpisodePicker title={title} locale="pt-BR" canWatch onSelect={onSelect} />);

    await user.click(await screen.findByRole('button', { name: 'Esquecer progresso' }));
    expect(mocks.clearProgress).toHaveBeenCalledWith('tt0182576');
    expect(await screen.findByRole('button', { name: 'Começar T16E05' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Esquecer progresso' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como assistido T16E05' })).toBeInTheDocument();
  });
});
