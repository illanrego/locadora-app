// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const render = vi.hoisted(() => vi.fn());
vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = {};
    setPixelRatio() {} setSize() {} dispose() {}
    render = render;
  },
}));
import { createImmersiveShelf } from '../src/locadora/web-scene/immersive-shelf.mjs';
import { DEFAULT_IMMERSIVE_THEME } from '../src/locadora/immersive';
import { normalizeDiscoveryTitle } from '../src/domain/content';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('constructs the web room, selects its tapes by keyboard and disposes its canvas', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({
    canvas: { width: 1024, height: 240 }, measureText: () => ({ width: 100 }),
  }, { get(target, name) { return target[name as keyof typeof target] ?? (() => {}); } }) as unknown as CanvasRenderingContext2D);
  const host = document.createElement('div');
  document.body.append(host);
  const selected = vi.fn();
  const title = normalizeDiscoveryTitle({ id: 1, type: 'movie', name: 'Synthetic', year: 1999 })!;
  const item = { ...title, id: title.identity.canonicalKey, type: title.identity.type, posterUrl: '' };
  const scene = createImmersiveShelf({ container: host, titles: [item], genre: 'Action', year: 1999, type: 'movie', stand: 0,
    theme: DEFAULT_IMMERSIVE_THEME, onSelect: selected, onBoundary: vi.fn(), onConfigure: vi.fn(),
    plaqueOptions: { genres: ['Action'], genreLabel: 'Genre', yearLabel: 'Year', go: 'Go', allYears: '', allProviders: '', sort: 'relevance', sortLabel: 'Sort by', sortChoices: [['relevance', 'Relevance'], ['year', 'Year'], ['rating', 'Rating']] } });
  frames.shift()!(100);
  expect(render).toHaveBeenCalled();
  host.querySelector('canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(selected).toHaveBeenCalledWith(item, '');
  scene.zoomIn(); scene.zoomOut(); scene.setActive(false);
  scene.dispose();
  expect(host.querySelector('canvas')).toBeNull();
});
