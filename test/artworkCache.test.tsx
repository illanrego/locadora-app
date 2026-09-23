// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { VhsTape } from '../src/components/VhsTape';
import { useInspectionArtwork } from '../src/locadora/artworkCache';

const native = vi.hoisted(() => ({
  isNativeShell: vi.fn(() => false),
  fetchNativePublicArtwork: vi.fn<(url: string) => Promise<string>>(),
}));

vi.mock('../src/platform/nativeBridge', () => native);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  native.isNativeShell.mockReturnValue(false);
  native.fetchNativePublicArtwork.mockReset();
  delete (window as unknown as Record<string, unknown>).caches;
});

function InspectionArtworkProbe({ url }: { url: string }) {
  const source = useInspectionArtwork(url, 'poster');
  return <output>{source ?? 'loading'}</output>;
}

describe('artwork loading', () => {
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

  it('uses the native artwork boundary for canvas-safe inspection images', async () => {
    const url = 'https://image.tmdb.org/t/p/w500/poster.jpg';
    native.isNativeShell.mockReturnValue(true);
    native.fetchNativePublicArtwork.mockResolvedValue('data:image/jpeg;base64,AQID');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/jpeg' },
    })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:inspection-poster');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<InspectionArtworkProbe url={url} />);

    expect(await screen.findByText('blob:inspection-poster')).toBeInTheDocument();
    expect(native.fetchNativePublicArtwork).toHaveBeenCalledWith(url);
  });
});
