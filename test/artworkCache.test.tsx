// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { VhsTape } from '../src/components/VhsTape';
import { artworkProxyUrl } from '../src/locadora/artworkCache';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).caches;
});

describe('artwork loading', () => {
  it('routes TMDB artwork through the Locadora proxy for canvas-safe loading', () => {
    expect(artworkProxyUrl('https://image.tmdb.org/t/p/w500/poster.jpg'))
      .toBe('https://locadora-api.willstartpage.workers.dev/v1/image?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fposter.jpg');
  });

  it('starts the poster request immediately while the persistent cache is slow', () => {
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        open: vi.fn(async () => ({
          match: vi.fn(async () => undefined),
          put: vi.fn(),
        })),
      },
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    const title = normalizeDiscoveryTitle({
      id: 603,
      type: 'movie',
      name: 'The Matrix',
      year: 1999,
      poster: 'https://images.example.invalid/matrix.jpg',
    })!;
    render(<VhsTape title={title} accent="#e24730" locale="pt-BR" onInspect={() => undefined} />);

    expect(document.querySelector('.case-art img')).toHaveAttribute('src', title.posterUrl!);
  });
});
