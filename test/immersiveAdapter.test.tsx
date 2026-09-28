// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  create: vi.fn(), artwork: vi.fn(), active: vi.fn(), poster: vi.fn(), dispose: vi.fn(),
}));
vi.mock('../src/locadora/web-scene/immersive-shelf.mjs', () => ({ createImmersiveShelf: mocks.create }));
vi.mock('../src/locadora/artworkCache', () => ({ resolveArtwork: mocks.artwork }));
import ImmersiveShelf from '../src/components/ImmersiveShelf';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { GENRES } from '../src/locadora/catalog';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReturnValue({ setActive: mocks.active, setPoster: mocks.poster, dispose: mocks.dispose });
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps original identities, pauses playback competition and ignores artwork after disposal', async () => {
  let finish!: (artwork: { blob: Blob }) => void;
  mocks.artwork.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const title = normalizeDiscoveryTitle({ id: 1, name: 'Synthetic', type: 'movie', posterUrl: 'https://image.tmdb.org/t/p/w500/synthetic.jpg' })!;
  const inspect = vi.fn();
  const failed = vi.fn();
  const props = { titles: [title], genre: GENRES[0], year: 1999, locale: 'en-US' as const, stand: 0,
    onInspect: inspect, onFailure: failed, onReady: vi.fn(), onConfigure: vi.fn(), onNavigate: vi.fn() };
  const view = render(<ImmersiveShelf {...props} />);
  const options = mocks.create.mock.calls[0][0];
  expect(options.titles[0].posterUrl).toBe('');
  options.onSelect(options.titles[0]);
  expect(inspect).toHaveBeenCalledWith(title);
  view.rerender(<ImmersiveShelf {...props} paused />);
  expect(mocks.active).toHaveBeenLastCalledWith(false);
  view.container.querySelector('.immersive-stage')!.dispatchEvent(new Event('webglcontextlost'));
  expect(failed).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => { finish({ blob: new Blob(['synthetic']) }); });
  await waitFor(() => expect(mocks.dispose).toHaveBeenCalledOnce());
  expect(mocks.poster).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
