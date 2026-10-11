// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { TitleSearch } from '../src/components/TitleSearch';
import { searchPeople } from '../src/locadora/discovery';
import { normalizePersonSearch } from '../src/locadora/personSearch';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  invoke.mockReset();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

const woody = { id: '1243', name: 'Woody Allen', profile: 'https://image.tmdb.org/t/p/w185/woody.jpg',
  knownFor: 'Directing', department: 'Directing' };

describe('person search', () => {
  it('bounds and validates untrusted person records', () => {
    expect(normalizePersonSearch({ people: 'bad' })).toBeNull();
    const people = normalizePersonSearch({ query: 'woody', people: [
      woody,
      { ...woody, id: '1244', name: 'Distractor', department: 'Not A Department', profile: 'http://image.tmdb.org/t/p/w185/no.jpg' },
      { ...woody, id: '0' },
      { ...woody, id: '1243' },
      ...Array.from({ length: 12 }, (_, index) => ({ ...woody, id: `${2000 + index}` })),
    ] });
    expect(people?.map((person) => person.id)).toEqual(['1243', '1244', '2000', '2001', '2002', '2003']);
    expect(people?.[0]).toEqual({ id: '1243', name: 'Woody Allen', department: 'Directing', profile: 'https://image.tmdb.org/t/p/w185/woody.jpg' });
    expect(people?.[1]).toMatchObject({ department: 'Acting', profile: null });
  });

  it('builds the person-search route with a trimmed query and locale', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: 'woody allen', people: [woody] }) });
    vi.stubGlobal('fetch', fetch);
    const people = await searchPeople('  woody allen  ', 'pt-BR');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/person-search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'woody allen', locale: 'pt-BR' });
    expect(people[0]).toEqual({ id: '1243', name: 'Woody Allen', department: 'Directing', profile: 'https://image.tmdb.org/t/p/w185/woody.jpg' });
    await expect(searchPeople(' x ', 'pt-BR')).rejects.toThrow('2 a 80');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the fixed native command when running in the desktop shell', async () => {
    invoke.mockResolvedValue({ query: 'woody allen', people: [woody] });
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const people = await searchPeople('woody allen', 'en-US');
    expect(invoke).toHaveBeenCalledWith('fetch_public_person_search', { request: { query: 'woody allen', locale: 'en-US' } });
    expect(people[0].name).toBe('Woody Allen');
  });

  it('switches to people mode, lists people, and opens the person view', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: 'woody allen', people: [woody] }) }));
    const openPerson = vi.fn();
    const user = userEvent.setup();
    render(<TitleSearch locale="pt-BR" onInspect={vi.fn()} onOpenPerson={openPerson} onClose={vi.fn()} />);
    const toggle = screen.getByRole('checkbox', { name: 'Buscar pessoas' });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.type(screen.getByRole('searchbox'), 'woody allen{Enter}');
    expect(await screen.findByRole('button', { name: 'Abrir ficha de Woody Allen' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 pessoa encontrada.');
    expect(screen.getByText('Direção')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir ficha de Woody Allen' }));
    expect(openPerson).toHaveBeenCalledWith({ id: '1243', name: 'Woody Allen', department: 'Directing', profile: 'https://image.tmdb.org/t/p/w185/woody.jpg' });
  });

  it('keeps the title search unchanged when the switch is off', async () => {
    const movie = { id: 'tmdb:603', type: 'movie', name: 'The Matrix', year: 1999, poster: 'https://image.tmdb.org/t/p/w500/matrix.jpg' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: 'matrix', titles: [movie] }) }));
    const inspect = vi.fn();
    const user = userEvent.setup();
    render(<TitleSearch locale="pt-BR" onInspect={inspect} onOpenPerson={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'matrix{Enter}');
    expect(await screen.findByRole('button', { name: 'Inspecionar The Matrix' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 título encontrado.');
  });

  it('shows empty and error states in people mode', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ query: 'none', people: [] }) })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<TitleSearch locale="en-US" onInspect={vi.fn()} onOpenPerson={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: 'Search people' }));
    await user.type(screen.getByRole('searchbox'), 'none{Enter}');
    expect(await screen.findByText('No people found.')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'again{Enter}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not search people.'));
  });
});
