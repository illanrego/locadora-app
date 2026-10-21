import { describe, expect, it } from 'vitest';
import shell from '../node_modules/@stremio/stremio-video/src/ShellVideo/ShellVideo.js?raw';
import css from '../src/styles.css?raw';
import { preserveOverlayBackgrounds } from '../tools/shellOverlayShim';
import { visibleVideoBounds } from '../src/media/videoBounds';

describe('native video presentation', () => {
  it('leaves background ownership with React for composited native playback', () => {
    const result = preserveOverlayBackgrounds(shell);
    const start = result.indexOf('function setBackground(visible)');
    const end = result.indexOf('// Preserve loading', start);
    const factory = new Function('options', 'window', `${result.slice(start, end)}; return setBackground;`);
    const parent = { style: { background: '#123' }, parentElement: null };
    const container = { style: { background: '#000' }, parentElement: parent };
    factory({ containerElement: container, shellTransport: { capabilities: { appOwnsVideoBackground: true } } }, {})(false);
    expect(container.style.background).toBe('#000');
    expect(parent.style.background).toBe('#123');
    factory({ containerElement: container }, {})(false);
    expect(parent.style.background).toBe('transparent');
  });
  it('keeps fullscreen video at the entire viewport through stale measurements and menu changes', () => {
    for (const rect of [
      { left: 0, top: 60, right: 960, bottom: 680 },
      { left: 0, top: 0, right: 1600, bottom: 1000 },
      { left: 0, top: 0, right: 0, bottom: 0 },
    ]) {
      expect(visibleVideoBounds(rect, 1920, 1080, true, true)).toEqual({
        x: 0, y: 0, width: 1920, height: 1080, viewportWidth: 1920,
        viewportHeight: 1080, visible: true, fullscreen: true,
      });
    }
    expect(visibleVideoBounds({ left: 0, top: 60, right: 960, bottom: 680 }, 1280, 800, true, false))
      .toMatchObject({ width: 960, height: 620, y: 60, fullscreen: false });
  });
  it('keeps a partially clipped or fractionally overflowing video visible', () => {
    const bounds = visibleVideoBounds({ left: -0.1, top: 50, right: 1000.1, bottom: 650 }, 1000, 600, true);
    expect(bounds).toMatchObject({ x: 0, y: 50, width: 1000, height: 550, visible: true });
    expect(visibleVideoBounds({ left: 1100, top: 0, right: 1200, bottom: 100 }, 1000, 600, true).visible).toBe(false);
    expect(visibleVideoBounds({ left: 0, top: 0, right: 100, bottom: 100 }, 1000, 600, false).visible).toBe(false);
  });
  it('removes the inset cover frame and respects reduced-motion loading', () => {
    expect(css).not.toContain('.case-art::after');
    expect(css).toContain('.brand strong, .brand-logo');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('.cinema-placeholder.is-loading .brand-logo { animation: none; }');
  });
  it('keeps fullscreen option panels beside the picture at every breakpoint', () => {
    const responsiveStack = css.indexOf('.cinema-body.has-panel { grid-template-columns: minmax(0, 1fr); grid-template-rows:');
    const fullscreenPanel = css.indexOf('.player-is-fullscreen .cinema-body.has-panel { grid-template-columns:');
    expect(responsiveStack).toBeGreaterThan(-1);
    expect(fullscreenPanel).toBeGreaterThan(responsiveStack);
    expect(css.slice(fullscreenPanel, fullscreenPanel + 220)).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(css).toContain('.watch-modal.player-is-fullscreen.fullscreen-idle[open] { grid-template-rows: minmax(0, 1fr); }');
  });
  it('keeps settings opaque and scrollable above both shelves and gives every select a dark option palette', () => {
    expect(css).toContain('select { color-scheme: dark; }');
    expect(css).toContain('select option { color: var(--cream); background: #101a28; }');
    expect(css).toMatch(/\.settings-drawer \{[^}]*position: absolute;[^}]*z-index: 40;[^}]*max-height:[^}]*overflow-y: auto;[^}]*background: #16233a;[^}]*pointer-events: auto;/);
    // One rule governs both modes: an immersive-only override was what turned
    // the panel into a wide translucent band over the 3D shelf.
    expect(css).not.toContain('.is-immersive .settings-drawer');
  });
});
