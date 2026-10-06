// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import css from '../src/styles.css?raw';

afterEach(() => {
  document.documentElement.classList.remove('player-open');
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('native video transparency and control stacking', () => {
  it('exposes only the video plane and restores the catalogue after closing', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = `<div id="root"><div class="app-shell">
      <header class="store-header">Catalogue</header>
      <dialog open class="modal watch-modal has-video player-is-fullscreen">
        <div class="cinema-body has-panel">
          <div class="cinema-screen"><div class="stremio-video-surface"><div class="cinema-placeholder">Loading</div></div></div>
          <aside class="cinema-panel">Subtitles</aside>
        </div>
        <section class="cinema-dock">Controls</section>
      </dialog>
    </div></div>`;
    document.documentElement.classList.add('player-open');
    const computed = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    for (const selector of ['html', 'body', '#root', '.app-shell', '.watch-modal', '.cinema-screen', '.stremio-video-surface']) {
      expect(computed(selector).backgroundColor, selector).toBe('rgba(0, 0, 0, 0)');
    }
    expect(computed('.store-header').visibility).toBe('hidden');
    expect(computed('.cinema-placeholder').display).toBe('none');
    expect(computed('.cinema-screen').position).toBe('absolute');
    expect(computed('.cinema-screen').inset).toBe('0px');
    expect(Number(computed('.cinema-panel').zIndex)).toBeGreaterThan(Number(computed('.cinema-screen').zIndex));
    expect(Number(computed('.cinema-dock').zIndex)).toBeGreaterThan(Number(computed('.cinema-screen').zIndex));
    document.documentElement.classList.remove('player-open');
    expect(computed('.store-header').visibility).toBe('visible');
    expect(computed('.app-shell').backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});
