import { describe, expect, it } from 'vitest';
import shell from '../node_modules/@stremio/stremio-video/src/ShellVideo/ShellVideo.js?raw';
import css from '../src/styles.css?raw';
import { preserveOverlayBackgrounds } from '../tools/shellOverlayShim';
import { visibleVideoBounds } from '../src/media/videoBounds';

describe('native video presentation', () => {
  it('guards the actual upstream ancestor-background mutation for native overlays only', () => {
    const result = preserveOverlayBackgrounds(shell);
    const start = result.indexOf('function setBackground(visible)');
    const end = result.indexOf('// Preserve loading', start);
    const factory = new Function('options', 'window', `${result.slice(start, end)}; return setBackground;`);
    const parent = { style: { background: '#123' }, parentElement: null };
    const container = { style: { background: '#000' }, parentElement: parent };
    factory({ containerElement: container, shellTransport: { capabilities: { nativeVideoOverlay: true } } }, {})(false);
    expect(container.style.background).toBe('#000');
    expect(parent.style.background).toBe('#123');
    factory({ containerElement: container }, {})(false);
    expect(parent.style.background).toBe('transparent');
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
});
