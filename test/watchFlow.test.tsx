// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StremioVideoController, StremioVideoState } from '../src/media/useStremioVideo';
import type { MediaResolution } from '../src/media/resolutionService';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { normalizeStreams } from '../src/media/normalization';

const mocks = vi.hoisted(() => ({
  controller: null as unknown as StremioVideoController,
  resolve: vi.fn(), subtitles: vi.fn(), configuration: vi.fn(),
}));
vi.mock('../src/media/useStremioVideo', () => ({ useStremioVideo: () => mocks.controller }));
vi.mock('../src/media/resolutionService', () => ({ resolveTitleMedia: mocks.resolve }));
vi.mock('../src/media/subtitleResolution', () => ({ resolveTitleSubtitles: mocks.subtitles }));
vi.mock('../src/platform/nativeBridge', () => ({ readMediaConfiguration: mocks.configuration }));
import { WatchFlow } from '../src/components/WatchFlow';

const title = normalizeDiscoveryTitle({ id: 1, type: 'movie', name: 'Synthetic screening', year: 2020 })!;
const candidates = normalizeStreams([
  { url: 'https://media.example.invalid/first', name: 'First', resolution: 1080, seeders: 20, behaviorHints: { videoSize: 1_000_000_000 } },
  { url: 'https://media.example.invalid/second', name: 'Second', resolution: 720, seeders: 10, behaviorHints: { videoSize: 800_000_000 } },
], 'synthetic');
const resolution: MediaResolution = {
  status: 'resolved', imdbId: null, candidates, manualCandidates: candidates, diagnostics: [],
  quickWatch: { winner: candidates[0], tier: 1, reason: 'selected-preferred-1080p', rulesVersion: 'movie-v1', consideredCandidateIds: candidates.map((candidate) => candidate.stableId), manualCandidateIds: [] },
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
    containerRef: { current: null }, state: { ...initialState }, load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn(), setPaused: vi.fn(), seekRelative: vi.fn(), seekTo: vi.fn(), setFullscreen: vi.fn(),
    setVolume: vi.fn(), setMuted: vi.fn(), selectAudioTrack: vi.fn(), selectSubtitleTrack: vi.fn(),
    setSubtitleDelay: vi.fn(), addExtraSubtitlesTracks: vi.fn().mockReturnValue(true),
  };
});
afterEach(cleanup);

function mount(quickWatchEnabled = true, locale: 'pt-BR' | 'en-US' = 'en-US') {
  const onClose = vi.fn();
  const props = { title, locale, mpvVersion: null, quickWatchEnabled, onClose };
  return { ...render(<WatchFlow {...props} />), onClose, props };
}

describe('cinema player interactions', () => {
  it('keeps successful playback uncluttered and switches sources through a secondary panel', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(mocks.controller.load).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sources' }));
    const panel = screen.getByRole('complementary', { name: 'Available sources' });
    const sourceButtons = within(panel).getAllByRole('listitem').map((li) => within(li).getByRole('button'));
    expect(sourceButtons[0]).toBeDisabled();
    await user.click(sourceButtons[1]);
    expect(mocks.controller.load).toHaveBeenLastCalledWith({ url: 'https://media.example.invalid/second' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
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
