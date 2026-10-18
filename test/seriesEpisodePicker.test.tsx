// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';

const mocks = vi.hoisted(() => ({ configuration: vi.fn(), fetcher: vi.fn() }));
vi.mock('../src/platform/nativeBridge', () => ({
  readMediaConfiguration: mocks.configuration,
  fetchConfiguredAddonResource: mocks.fetcher,
}));
import { SeriesEpisodePicker } from '../src/components/SeriesEpisodePicker';

const title = normalizeDiscoveryTitle({ id: 1, imdbId: 'tt0182576', type: 'series', name: 'Fixture series', year: 1999 })!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configuration.mockResolvedValue([
    { id: 'meta', name: 'Metadata', resources: ['meta'], supportsStreams: false, supportsSubtitles: false },
  ]);
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
});
