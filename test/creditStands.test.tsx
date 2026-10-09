// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';
import { normalizePerson } from '../src/locadora/creditStands';
import { loadCreditStand } from '../src/locadora/discovery';
import { PersonView } from '../src/components/PersonView';
import { TitleInspection } from '../src/components/TitleInspection';

vi.mock('../src/components/VhsInspection', () => ({ VhsInspection: () => <div /> }));

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const title = {
  id: 'tmdb:680', type: 'movie', name: 'Pulp Fiction', year: 1994,
  director: ['Quentin Tarantino'], writer: ['Quentin Tarantino'], cast: ['Samuel L. Jackson'],
  credits: {
    director: [{ id: '138', name: 'Quentin Tarantino' }],
    writer: [{ id: '138', name: 'Quentin Tarantino' }],
    cast: [{ id: '2231', name: 'Samuel L. Jackson', character: 'Jules Winnfield' }],
    crew: [{ id: '1000787', name: 'Sally Menke', department: 'Editing', job: 'Editor' }],
  },
};

describe('person stands', () => {
  it('groups TMDB jobs by department and rejects invalid profile data', () => {
    const person = normalizePerson({ person: { id: '138', name: 'Quentin Tarantino', roles: [
      { department: 'Writing', job: 'Screenplay', count: 6 },
      { department: 'Writing', job: 'Story', count: 4 },
      { department: 'Directing', job: 'Director', count: 8 },
      { department: 'Unsafe', job: 'Anything', count: 999 },
    ] } });
    expect(person?.roles).toEqual([{ department: 'Writing', count: 10 }, { department: 'Directing', count: 8 }]);
    expect(normalizePerson({ person: { id: '138&x=1', name: 'Bad' } })).toBeNull();
  });

  it('keeps id-bearing credits clickable and legacy names as text', async () => {
    const onCreditPerson = vi.fn();
    const normalized = normalizeDiscoveryTitle(title)!;
    const props = { title: normalized, locale: 'pt-BR' as const, isInBasket: false, basketFull: false,
      canWatch: false, savedForLater: false, favorite: false, onToggleBasket: vi.fn(), onToggleSaved: vi.fn(),
      onWatch: vi.fn(), onCreditPerson, onClose: vi.fn() };
    const user = userEvent.setup();
    const view = render(<TitleInspection {...props} />);
    await user.click(screen.getByText('Créditos da fita'));
    await user.click(screen.getAllByRole('button', { name: 'Quentin Tarantino' })[0]);
    expect(onCreditPerson).toHaveBeenCalledWith({ id: '138', name: 'Quentin Tarantino', department: 'Directing', profile: null });
    await user.click(screen.getByRole('button', { name: 'Ficha técnica · mais' }));
    await user.click(screen.getByRole('button', { name: 'Sally Menke · Editor' }));
    expect(onCreditPerson).toHaveBeenCalledWith({ id: '1000787', name: 'Sally Menke', department: 'Editing', profile: null });
    view.rerender(<TitleInspection {...props} title={normalizeDiscoveryTitle({ ...title, credits: undefined })!} />);
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Quentin Tarantino' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Quentin Tarantino')).toHaveLength(2);
  });

  it('requests a mixed movie and series stand with no provider or year filter', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ titles: [{ ...title, credits: undefined }, { id: 'tmdb:7', type: 'series', name: 'Sample series', year: 2001 }], hasNextStand: true }) });
    vi.stubGlobal('fetch', fetch);
    const page = await loadCreditStand({ credit: { id: '138', name: 'Quentin Tarantino', department: 'Writing', profile: null }, year: 1999, stand: 1, sort: 'rating', locale: 'pt-BR' });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/credit-stand');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ person: '138', department: 'Writing', job: '', type: 'all', year: '1999', ignoreStoreYear: 'true', providers: '', stand: '1', sort: 'rating', locale: 'pt-BR' });
    expect(page.titles.map((item) => item.identity.type)).toEqual(['movie', 'series']);
    expect(page.hasNextStand).toBe(true);
  });

  it('loads a person, shows grouped roles and filmography, then opens a department stand', async () => {
    const fetch = vi.fn().mockImplementation(async (input: URL) => ({ ok: true, json: async () => input.pathname.endsWith('/person')
      ? { person: { id: '138', name: 'Quentin Tarantino', profile: '', knownFor: 'Directing', roles: [
        { department: 'Writing', job: 'Screenplay', count: 6 }, { department: 'Writing', job: 'Story', count: 4 },
      ] } }
      : { titles: [title], hasNextStand: false } }));
    vi.stubGlobal('fetch', fetch);
    const onViewAsStand = vi.fn();
    const user = userEvent.setup();
    render(<PersonView credit={{ id: '138', name: 'Quentin Tarantino', department: 'Writing', profile: null }} year={1999} sort="relevance" locale="pt-BR" onViewAsStand={onViewAsStand} onInspect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Roteiro 10' })).toBeInTheDocument();
    expect(await screen.findByText('Pulp Fiction')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver como estante' }));
    expect(onViewAsStand).toHaveBeenCalledWith({ id: '138', name: 'Quentin Tarantino', department: 'Writing', profile: null });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
