// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StremioVideoController, StremioVideoState } from '../src/media/useStremioVideo';
import type { MediaResolution } from '../src/media/resolutionService';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { normalizeStreams } from '../src/media/normalization';

const mocks = vi.hoisted(() => ({
  controller: null as unknown as StremioVideoController,
  resolve: vi.fn(), subtitles: vi.fn(), configuration: vi.fn(), setWatched: vi.fn(),
}));
vi.mock('../src/media/useStremioVideo', () => ({ useStremioVideo: () => mocks.controller }));
vi.mock('../src/media/resolutionService', () => ({ resolveTitleMedia: mocks.resolve }));
vi.mock('../src/media/subtitleResolution', () => ({ resolveTitleSubtitles: mocks.subtitles }));
vi.mock('../src/platform/nativeBridge', () => ({ readMediaConfiguration: mocks.configuration }));
vi.mock('../src/locadora/localCache', () => ({ setEpisodeWatched: mocks.setWatched }));
import { WatchFlow } from '../src/components/WatchFlow';

const title = normalizeDiscoveryTitle({ id: 1, type: 'movie', name: 'Synthetic screening', year: 2020 })!;
const seriesTitle = normalizeDiscoveryTitle({ id: 2, imdbId: 'tt0182576', type: 'series', name: 'Synthetic series', year: 1999 })!;
const candidates = normalizeStreams([
  { url: 'https://media.example.invalid/first', name: 'First', resolution: 1080, seeders: 20, behaviorHints: { videoSize: 1_000_000_000 } },
  { url: 'https://media.example.invalid/second', name: 'Second', resolution: 720, seeders: 10, behaviorHints: { videoSize: 800_000_000 } },
], 'synthetic');
const resolution: MediaResolution = {
  status: 'resolved', imdbId: null, candidates, manualCandidates: candidates, diagnostics: [],
  quickWatch: { winner: candidates[0], tier: 1, reason: 'selected-preferred-1080p', rulesVersion: 'movie-v1', consideredCandidateIds: candidates.map((candidate) => candidate.stableId), manualCandidateIds: [] },
};
const seriesCandidates = [
  { ...candidates[0], sourceName: 'The Pirate Bay', sizeBytes: 350 * 1024 ** 2, seeders: 40 },
  { ...candidates[0], stableId: 'series-larger-1080p', sourceName: 'RARBG', sizeBytes: 700 * 1024 ** 2, seeders: 200 },
  { ...candidates[1], stableId: 'series-720p-fallback', sourceName: 'The Pirate Bay', sizeBytes: 300 * 1024 ** 2, seeders: 500 },
];
const seriesResolution: MediaResolution = {
  ...resolution, candidates: seriesCandidates, manualCandidates: seriesCandidates,
  quickWatch: { winner: seriesCandidates[0], tier: 1, reason: 'selected-preferred-1080p', rulesVersion: 'series-v1', consideredCandidateIds: [seriesCandidates[0].stableId], manualCandidateIds: seriesCandidates.map((candidate) => candidate.stableId) },
};
const seasonPackCandidate = { ...candidates[0], sizeBytes: 3 * 1024 ** 3 };
const seasonPackResolution: MediaResolution = {
  status: 'manual-selection-required', imdbId: 'tt0182576', candidates: [seasonPackCandidate], manualCandidates: [seasonPackCandidate], diagnostics: [],
  quickWatch: { winner: null, tier: null, reason: 'series-requires-manual-selection', rulesVersion: 'series-v1', consideredCandidateIds: [seasonPackCandidate.stableId], manualCandidateIds: [seasonPackCandidate.stableId] },
};
const unusableEpisodeCandidate = { ...candidates[0], sizeBytes: null, parseConfidence: 'partial' as const };
const unusableEpisodeResolution: MediaResolution = {
  status: 'manual-selection-required', imdbId: 'tt0182576', candidates: [unusableEpisodeCandidate], manualCandidates: [unusableEpisodeCandidate], diagnostics: [],
  quickWatch: { winner: null, tier: null, reason: 'series-requires-manual-selection', rulesVersion: 'series-v1', consideredCandidateIds: [], manualCandidateIds: [unusableEpisodeCandidate.stableId] },
};
const initialState: StremioVideoState = {
  loaded: true, paused: false, buffering: false, time: 10_000, duration: 120_000, buffered: 40_000,
  subtitleLoading: false, subtitleError: null, audioTracks: [], selectedAudioTrackId: null,
  subtitlesTracks: [{ id: 'EMBEDDED_1', lang: 'pt-BR', label: 'Português' }], selectedSubtitlesTrackId: null,
  subtitlesDelay: 0, extraSubtitlesTracks: [], selectedExtraSubtitlesTrackId: null, extraSubtitlesDelay: 0,
  streamingServiceAvailable: null, error: null, ended: false, fullscreen: false, volume: 70, muted: false,
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
});
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.configuration.mockResolvedValue([]);
  mocks.resolve.mockResolvedValue(resolution);
  mocks.subtitles.mockResolvedValue([]);
  mocks.controller = {
    viewportRef: { current: null }, containerRef: { current: null }, state: { ...initialState }, load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn(), setPaused: vi.fn(), seekRelative: vi.fn(), seekTo: vi.fn(), setFullscreen: vi.fn(),
    refreshBounds: vi.fn(),
    setVolume: vi.fn(), setMuted: vi.fn(), selectAudioTrack: vi.fn(), selectSubtitleTrack: vi.fn(),
    setSubtitleDelay: vi.fn(), addExtraSubtitlesTracks: vi.fn().mockReturnValue(true),
  };
});
afterEach(cleanup);

function mount(quickWatchEnabled = true, locale: 'pt-BR' | 'en-US' = 'en-US', episode: { season: number; episode: number; name?: string } | null = null, selectedTitle = title) {
  const onClose = vi.fn();
  const props = { title: selectedTitle, locale, mpvVersion: null, quickWatchEnabled, episode, onClose };
  return { ...render(<WatchFlow {...props} />), onClose, props };
}

describe('cinema player interactions', () => {
  it('scopes native video transparency to the player lifetime', async () => {
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    expect(document.documentElement).toHaveClass('player-open');
    expect(screen.getByRole('dialog')).toHaveClass('has-video');
    view.unmount();
    expect(document.documentElement).not.toHaveClass('player-open');
  });

  it('shows a recovery message during a fullscreen stall and clears it on resume or user pause', async () => {
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    mocks.controller.state = { ...initialState, fullscreen: true, buffering: true };
    view.rerender(<WatchFlow {...view.props} />);
    expect(screen.getByText('Waiting for more video before continuing.')).toBeInTheDocument();
    mocks.controller.state = { ...initialState, fullscreen: true };
    view.rerender(<WatchFlow {...view.props} />);
    expect(screen.queryByText('Waiting for more video before continuing.')).not.toBeInTheDocument();
    mocks.controller.state = { ...initialState, fullscreen: true, buffering: true, paused: true };
    view.rerender(<WatchFlow {...view.props} />);
    expect(screen.queryByText('Waiting for more video before continuing.')).not.toBeInTheDocument();
  });

  it('toggles fullscreen in both directions by double-clicking the picture', async () => {
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    fireEvent.doubleClick(screen.getByLabelText('Synthetic screening video'));
    expect(mocks.controller.setFullscreen).toHaveBeenLastCalledWith(true);
    mocks.controller.state = { ...initialState, fullscreen: true };
    view.rerender(<WatchFlow {...view.props} />);
    fireEvent.doubleClick(screen.getByLabelText('Synthetic screening video'));
    expect(mocks.controller.setFullscreen).toHaveBeenLastCalledWith(false);
  });

  it('keeps successful playback uncluttered and switches sources through a secondary panel', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalledTimes(1));
    expect(mocks.controller.load).toHaveBeenCalledWith({ url: 'https://media.example.invalid/first' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sources' }));
    const panel = screen.getByRole('complementary', { name: 'Available sources' });
    const sourceButtons = within(panel).getAllByRole('listitem').map((li) => within(li).getByRole('button'));
    expect(sourceButtons[0]).toBeDisabled();
    await user.click(sourceButtons[1]);
    expect(mocks.controller.load).toHaveBeenLastCalledWith({ url: 'https://media.example.invalid/second' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('filters sources by resolution and keeps the selected source when switching filters', async () => {
    const user = userEvent.setup();
    mount(false, 'pt-BR');
    const filter = await screen.findByRole('combobox', { name: 'Resolução' });
    expect(filter).toHaveValue('all');
    await user.selectOptions(filter, '720');
    const list = screen.getByRole('list', { name: 'Fontes disponíveis' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('720p');
    expect(mocks.controller.load).not.toHaveBeenCalled();
    await user.click(within(list).getByRole('button'));
    expect(mocks.controller.load).toHaveBeenLastCalledWith({ url: 'https://media.example.invalid/second' });
  });

  it('reveals fullscreen controls on movement and retains them while options are open', async () => {
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    vi.useFakeTimers();
    try {
      mocks.controller.state = { ...initialState, fullscreen: true };
      view.rerender(<WatchFlow {...view.props} />);
      const dialog = screen.getByRole('dialog');
      act(() => vi.advanceTimersByTime(3000));
      expect(dialog).toHaveClass('controls-hidden');
      expect(dialog).toHaveClass('fullscreen-idle');
      fireEvent.pointerMove(dialog);
      expect(dialog).not.toHaveClass('controls-hidden');
      expect(dialog).toHaveClass('fullscreen-controls-visible');
      fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
      expect(dialog).toHaveClass('fullscreen-panel-open');
      act(() => vi.advanceTimersByTime(5000));
      expect(dialog).not.toHaveClass('controls-hidden');
      expect(mocks.controller.refreshBounds).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not carry windowed control hover into fullscreen auto-hide', async () => {
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Fullscreen' }));
    vi.useFakeTimers();
    try {
      mocks.controller.state = { ...initialState, fullscreen: true };
      view.rerender(<WatchFlow {...view.props} />);
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByRole('dialog')).toHaveClass('fullscreen-idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts fullscreen auto-hide when the pointer leaves the player', async () => {
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    mocks.controller.state = { ...initialState, fullscreen: true };
    view.rerender(<WatchFlow {...view.props} />);
    vi.useFakeTimers();
    try {
      fireEvent.pointerMove(screen.getByRole('button', { name: 'Exit fullscreen' }));
      fireEvent.pointerLeave(screen.getByRole('dialog'));
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByRole('dialog')).toHaveClass('fullscreen-idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes a windowed options panel when entering fullscreen', async () => {
    const user = userEvent.setup();
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Sources' }));
    expect(screen.getByRole('complementary', { name: 'Available sources' })).toBeVisible();
    mocks.controller.state = { ...initialState, fullscreen: true };
    view.rerender(<WatchFlow {...view.props} />);
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog')).toHaveClass('fullscreen-controls-visible');
  });

  it('loads the series evaluator winner for an episode when Quick Watch is enabled', async () => {
    mocks.resolve.mockResolvedValue(seriesResolution);
    mount(true, 'en-US', { season: 16, episode: 5, name: 'Family Guy' }, seriesTitle);
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalledWith({ url: 'https://media.example.invalid/first' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ episode: { season: 16, episode: 5, name: 'Family Guy' } }),
    );
  });

  it.each([
    ['en-US', 'Available sources', 'Resolution', 'No episode-appropriate source was found: only season packs are available. Select a source.'],
    ['pt-BR', 'Fontes disponíveis', 'Resolução', 'Nenhuma fonte adequada para este episódio: somente pacotes de temporada. Selecione uma fonte.'],
  ] as const)('opens the picker without loading when an episode has only a season pack (%s)', async (locale, listName, filterName, message) => {
    mocks.resolve.mockResolvedValue(seasonPackResolution);
    mount(true, locale, { season: 16, episode: 5 }, seriesTitle);
    await screen.findByRole('list', { name: listName });
    expect(mocks.controller.load).not.toHaveBeenCalled();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: filterName })).toHaveValue('1080');
  });

  it.each([
    ['en-US', 'Resolution', 'Quick Watch episode rules selected a source.'],
    ['pt-BR', 'Resolução', 'As regras de episódio do Quick Watch selecionaram uma fonte.'],
  ] as const)('keeps every returned resolution reachable from an episode picker (%s)', async (locale, filterName, message) => {
    mocks.resolve.mockResolvedValue(seriesResolution);
    mount(false, locale, { season: 16, episode: 5 }, seriesTitle);
    const filter = await screen.findByRole('combobox', { name: filterName });
    expect(filter).toHaveValue('1080');
    expect(within(filter).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['all', '1080', '720']);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it.each([
    ['en-US', 'Available sources', 'Quick Watch episode rules found nothing usable. Select a source.'],
    ['pt-BR', 'Fontes disponíveis', 'As regras de episódio do Quick Watch não encontraram nenhuma fonte utilizável. Selecione uma fonte.'],
  ] as const)('explains an unusable episode result and keeps the picker as the fallback (%s)', async (locale, listName, message) => {
    mocks.resolve.mockResolvedValue(unusableEpisodeResolution);
    mount(true, locale, { season: 16, episode: 5 }, seriesTitle);
    await screen.findByRole('list', { name: listName });
    expect(mocks.controller.load).not.toHaveBeenCalled();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('auto-marks at the threshold only once per episode player session', async () => {
    const view = mount(true, 'en-US', { season: 16, episode: 5 }, seriesTitle);
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());

    mocks.controller.state = { ...initialState, time: 89_000, duration: 100_000 };
    view.rerender(<WatchFlow {...view.props} />);
    expect(mocks.setWatched).not.toHaveBeenCalled();
    mocks.controller.state = { ...initialState, time: 90_000, duration: 100_000 };
    view.rerender(<WatchFlow {...view.props} />);
    await waitFor(() => expect(mocks.setWatched).toHaveBeenCalledTimes(1));
    expect(mocks.setWatched).toHaveBeenCalledWith('tt0182576', { season: 16, episode: 5 }, true);
    mocks.controller.state = { ...initialState, time: 99_000, duration: 100_000 };
    view.rerender(<WatchFlow {...view.props} />);
    expect(mocks.setWatched).toHaveBeenCalledTimes(1);
  });

  it('opens sources without autoplay when Quick Watch is off and allows retry after load failure', async () => {
    const user = userEvent.setup();
    mocks.controller.load = vi.fn().mockRejectedValueOnce(new Error('Source unavailable')).mockResolvedValue(undefined);
    mount(false);
    const list = await screen.findByRole('list', { name: 'Available sources' });
    expect(mocks.controller.load).not.toHaveBeenCalled();
    await user.click(within(list).getAllByRole('button')[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Source unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mocks.controller.load).toHaveBeenCalledTimes(2);
  });

  it('keeps subtitle sync visible after selection and does not close the movie when escaping a panel', async () => {
    const user = userEvent.setup();
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Audio & subtitles' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Subtitles' }), 'embedded:EMBEDDED_1');
    expect(mocks.controller.selectSubtitleTrack).toHaveBeenCalledWith('EMBEDDED_1', false);
    mocks.controller.state = { ...initialState, selectedSubtitlesTrackId: 'EMBEDDED_1' };
    view.rerender(<WatchFlow {...view.props} />);
    expect(screen.getByRole('spinbutton', { name: 'Subtitle delay in seconds' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Earlier −0.5s' }));
    expect(mocks.controller.setSubtitleDelay).toHaveBeenLastCalledWith(-500, false);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(mocks.controller.setSubtitleDelay).not.toHaveBeenCalledWith(NaN, false);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Audio & subtitles' })).toHaveFocus();
  });

  it('commits scrubbing, handles cancelled drags and preserves native button keyboard activation', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    const seek = screen.getByRole('slider', { name: 'Playback position' });
    fireEvent.change(seek, { target: { value: '25000' } });
    expect(mocks.controller.seekTo).not.toHaveBeenCalled();
    fireEvent.pointerUp(seek);
    expect(mocks.controller.seekTo).toHaveBeenLastCalledWith(25_000);
    fireEvent.change(seek, { target: { value: '60000' } });
    fireEvent.pointerCancel(seek);
    expect(seek).toHaveValue('10000');
    screen.getByRole('button', { name: 'Pause' }).focus();
    await user.keyboard(' ');
    expect(mocks.controller.setPaused).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mocks.controller.seekRelative).toHaveBeenCalledWith(10);
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '45' } });
    expect(mocks.controller.setVolume).toHaveBeenCalledWith(45);
    await user.click(screen.getByRole('button', { name: 'Mute' }));
    expect(mocks.controller.setMuted).toHaveBeenCalledWith(true);
  });

  it('returns from fullscreen before dismissing the dialog and offers replay after ending', async () => {
    const view = mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalled());
    mocks.controller.state = { ...initialState, fullscreen: true };
    view.rerender(<WatchFlow {...view.props} />);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(mocks.controller.setFullscreen).toHaveBeenCalledWith(false);
    expect(view.onClose).not.toHaveBeenCalled();
    mocks.controller.state = { ...initialState, ended: true };
    view.rerender(<WatchFlow {...view.props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(mocks.controller.load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Locadora' }));
    expect(mocks.controller.unload).toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps cancellation available while resolving and ignores late results after unmount', async () => {
    let resolve!: (value: MediaResolution) => void;
    mocks.resolve.mockImplementation(() => new Promise<MediaResolution>((done) => { resolve = done; }));
    const view = mount(true, 'pt-BR');
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(view.onClose).toHaveBeenCalled();
    view.unmount();
    resolve(resolution);
    await Promise.resolve();
    expect(mocks.controller.load).not.toHaveBeenCalled();
  });
});
