// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tapePlatform = vi.hoisted(() => ({
  readTapeManifest: vi.fn(),
  requestTapeEngine: vi.fn(),
  TAPE_ENGINE_ORIGIN: 'http://127.0.0.1:11472',
}));

vi.mock('../src/platform/tape', () => tapePlatform);

import { TapeDashboard } from '../src/components/TapeDashboard';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { tapeStateLabel, formatTapeTotal, readTapeUploaded } from '../src/rentals/tapeDashboard';
import { TAPE_GIBIBYTE, TAPE_STATES, type TapeRecord, type TapeState } from '../src/rentals/tapeManifest';
import { writeTapeSettings } from '../src/rentals/tapeSettings';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

function tape(overrides: Partial<TapeRecord> & Pick<TapeRecord, 'infoHash' | 'title' | 'state' | 'sizeBytes'>): TapeRecord {
  return {
    rentalId: `rental-${overrides.infoHash.slice(0, 4)}`,
    contentId: 'movie:tmdb:1',
    fileIdx: 0,
    fileName: 'feature.mkv',
    descriptor: { sources: ['udp://tracker.invalid:80'], magnet: `magnet:?xt=urn:btih:${overrides.infoHash}` },
    torrentBytesB64: null,
    addedAt: '2026-10-17T12:00:00.000Z',
    completedAt: null,
    lastPlayedAt: null,
    ...overrides,
  };
}

const manifest = {
  version: 1 as const,
  tapes: [
    tape({
      infoHash: HASH_A,
      contentId: 'movie:tmdb:603',
      title: 'Fita Um',
      state: 'downloading',
      sizeBytes: 3 * TAPE_GIBIBYTE,
      lastPlayedAt: '2026-10-18T20:00:00.000Z',
    }),
    tape({
      infoHash: HASH_B,
      contentId: 'movie:tmdb:604',
      title: 'Fita Dois',
      state: 'ready',
      sizeBytes: Math.round(1.2 * TAPE_GIBIBYTE),
    }),
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  writeTapeSettings({ maxGb: 6 });
  tapePlatform.readTapeManifest.mockResolvedValue(manifest);
  tapePlatform.requestTapeEngine.mockImplementation(async (url: string) => {
    if (url.includes(HASH_A)) {
      return { status: 200, body: JSON.stringify({ downloaded: 1, uploaded: 2.5 * TAPE_GIBIBYTE }), contentType: 'application/json' };
    }
    return { status: 404, body: '{}', contentType: 'application/json' };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('rented-tape dashboard', () => {
  it('lists exactly the manifest tapes with readable state, size, uploaded and last played', async () => {
    render(<TapeDashboard locale="pt-BR" onInspect={vi.fn()} />);

    const region = await screen.findByRole('region', { name: 'Fitas neste aparelho' });
    const rows = within(region).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + two manifest tapes
    expect(within(region).getByRole('row', { name: /Fita Um/ })).toHaveTextContent('baixando');
    expect(within(region).getByRole('row', { name: /Fita Um/ })).toHaveTextContent('3 GB');
    expect(within(region).getByRole('row', { name: /Fita Um/ })).toHaveTextContent('2,5 GB');
    expect(within(region).getByRole('row', { name: /Fita Dois/ })).toHaveTextContent('pronta');
    expect(within(region).queryByText('Fita Três')).not.toBeInTheDocument();
    // Last played is known for one row and a dash for the other.
    const lastPlayed = within(region).getByRole('row', { name: /Fita Um/ }).querySelectorAll('td')[3];
    expect(lastPlayed.textContent).toMatch(/2026/);
    expect(within(region).getByRole('row', { name: /Fita Dois/ }).querySelectorAll('td')[3].textContent).toBe('—');
  });

  it('renders nothing at all when the manifest is empty', async () => {
    tapePlatform.readTapeManifest.mockResolvedValue({ version: 1, tapes: [] });
    const { container } = render(<TapeDashboard locale="pt-BR" onInspect={vi.fn()} />);

    await waitFor(() => expect(tapePlatform.readTapeManifest).toHaveBeenCalledOnce());
    expect(screen.queryByRole('region', { name: 'Fitas neste aparelho' })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    expect(tapePlatform.requestTapeEngine).not.toHaveBeenCalled();
  });

  it('renders nothing when the manifest itself cannot be read', async () => {
    tapePlatform.readTapeManifest.mockRejectedValue(new Error('read-failed'));
    const { container } = render(<TapeDashboard locale="en-US" onInspect={vi.fn()} />);

    await waitFor(() => expect(tapePlatform.readTapeManifest).toHaveBeenCalledOnce());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a dash, never a zero, when the engine is off', async () => {
    tapePlatform.requestTapeEngine.mockRejectedValue(new Error('engine-unavailable'));
    render(<TapeDashboard locale="pt-BR" onInspect={vi.fn()} />);

    const region = await screen.findByRole('region', { name: 'Fitas neste aparelho' });
    expect(within(region).getAllByLabelText('envio desconhecido')).toHaveLength(2);
    expect(within(region).queryByText('0 MB')).not.toBeInTheDocument();
  });

  it('shows a dash for a non-200 or a malformed stats reply', async () => {
    tapePlatform.requestTapeEngine.mockImplementation(async (url: string) => (
      url.includes(HASH_A)
        ? { status: 200, body: 'not json', contentType: 'application/json' }
        : { status: 500, body: '{"uploaded": 10}', contentType: 'application/json' }
    ));
    render(<TapeDashboard locale="en-US" onInspect={vi.fn()} />);

    const region = await screen.findByRole('region', { name: 'Tapes on this device' });
    expect(within(region).getAllByLabelText('upload unknown')).toHaveLength(2);
  });

  it('states the manifest total against the configured ceiling, and a null ceiling in words', async () => {
    const { unmount } = render(<TapeDashboard locale="pt-BR" onInspect={vi.fn()} />);
    expect(await screen.findByText('4,2 GB de 6 GB')).toBeInTheDocument();

    unmount();
    writeTapeSettings({ maxGb: 0 });
    render(<TapeDashboard locale="pt-BR" onInspect={vi.fn()} />);
    expect(await screen.findByText('4,2 GB · sem limite de espaço')).toBeInTheDocument();
  });

  it('carries the disclosure sentence and the accessible section name in both locales', async () => {
    const { unmount } = render(<TapeDashboard locale="pt-BR" onInspect={vi.fn()} />);
    expect(await screen.findByText(
      'Suas fitas alugadas são baixadas aqui e compartilhadas de volta enquanto a Locadora estiver aberta.',
    )).toBeInTheDocument();

    unmount();
    render(<TapeDashboard locale="en-US" onInspect={vi.fn()} />);
    expect(await screen.findByText(
      'Your rented tapes download here and are shared back while Locadora is open.',
    )).toBeInTheDocument();
  });

  it('offers only "inspect this title": keyboard reachable, nothing that mutates a tape', async () => {
    const matrix = normalizeDiscoveryTitle({ tmdbId: 603, type: 'movie', name: 'Fita Um', year: 1999 })!;
    const inspect = vi.fn();
    const user = userEvent.setup();
    render(<TapeDashboard locale="pt-BR" onInspect={inspect} knownTitles={[matrix]} />);

    const region = await screen.findByRole('region', { name: 'Fitas neste aparelho' });
    expect(within(region).getAllByRole('button')).toHaveLength(1);
    const button = within(region).getByRole('button', { name: 'Inspecionar Fita Um' });
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(inspect).toHaveBeenCalledWith(matrix);
    expect(within(region).queryByRole('button', { name: /devolver|remover|excluir|tentar/i })).not.toBeInTheDocument();
    // Every bridge call is a read of stats.json; the dashboard never removes,
    // starts, retries or reprioritises anything.
    for (const [url, method] of tapePlatform.requestTapeEngine.mock.calls) {
      expect(method).toBe('GET');
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:11472\/[0-9a-f]{40}\/0\/stats\.json$/);
    }
  });
});

describe('tape dashboard pure helpers', () => {
  it('renders every manifest state as a readable word in both locales', () => {
    const expected: Record<TapeState, [string, string]> = {
      queued: ['na fila', 'queued'],
      resolving: ['verificando', 'checking'],
      downloading: ['baixando', 'downloading'],
      ready: ['pronta', 'ready'],
      seeding: ['compartilhando', 'sharing'],
      failed: ['falhou', 'failed'],
      returned: ['devolvida', 'returned'],
      unverified: ['não verificada', 'unverified'],
    };
    for (const state of TAPE_STATES) {
      expect(tapeStateLabel(state, 'pt-BR')).toBe(expected[state][0]);
      expect(tapeStateLabel(state, 'en-US')).toBe(expected[state][1]);
    }
  });

  it('sums the manifest rows and refuses to turn a missing upload into zero', () => {
    expect(formatTapeTotal([{ sizeBytes: TAPE_GIBIBYTE }, { sizeBytes: TAPE_GIBIBYTE }], 6 * TAPE_GIBIBYTE, 'en-US'))
      .toBe('2 GB of 6 GB');
    expect(readTapeUploaded('{"uploaded": 0}')).toBe(0);
    expect(readTapeUploaded('{"uploaded": -1}')).toBeNull();
    expect(readTapeUploaded('{"uploaded": "12"}')).toBeNull();
    expect(readTapeUploaded('{"downloaded": 5}')).toBeNull();
    expect(readTapeUploaded('')).toBeNull();
    expect(readTapeUploaded('[]')).toBeNull();
  });
});
