// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryTitle } from '../src/domain/content';

const discovery = vi.hoisted(() => ({
  loadShelf: vi.fn(),
  loadTitleDetails: vi.fn(),
}));

vi.mock('../src/locadora/discovery', () => discovery);

import App from '../src/App';

function title(id: number, name: string): DiscoveryTitle {
  return {
    identity: {
      canonicalKey: `movie:tmdb:${id}`,
      type: 'movie',
      externalIdentities: [{ namespace: 'tmdb', externalId: String(id) }],
    },
    name,
    year: 1999,
    genres: ['Action'],
    description: '',
    posterUrl: `https://images.example.invalid/${id}.jpg`,
    backdropUrl: null,
    imdbRating: null,
    runtimeMinutes: null,
    certificationBR: null,
    director: [],
    writer: [],
    cast: [],
    providers: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  discovery.loadShelf.mockImplementation(async ({ stand }: { stand: number }) => stand === 0
    ? { titles: [title(1, 'First Stand Tape')], hasNextStand: true, source: 'public-api' }
    : { titles: [title(2, 'Second Stand Tape')], hasNextStand: false, source: 'public-api' });
  discovery.loadTitleDetails.mockImplementation(async (value: DiscoveryTitle) => value);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('physical shelf pagination', () => {
  it('appends each catalogue page as a separate stand with cached cover loading', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const firstStand = await screen.findByRole('region', { name: 'Estante 1' });
    expect(within(firstStand).getByRole('button', { name: /First Stand Tape/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carregar outra estante' }));

    const secondStand = await screen.findByRole('region', { name: 'Estante 2' });
    expect(within(firstStand).getByRole('button', { name: /First Stand Tape/i })).toBeInTheDocument();
    expect(within(secondStand).getByRole('button', { name: /Second Stand Tape/i })).toBeInTheDocument();
    expect(container.querySelectorAll('.shelf')).toHaveLength(2);
    expect(secondStand.querySelector('img')).toHaveAttribute('src', 'https://images.example.invalid/2.jpg');
    expect(secondStand.querySelector('img')).toHaveAttribute('decoding', 'async');
  });
});
