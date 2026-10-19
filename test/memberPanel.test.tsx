// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  readMemberSession: vi.fn(),
  signInMember: vi.fn(),
  signUpMember: vi.fn(),
  updateMemberProfile: vi.fn(),
  updateMemberRentalLimit: vi.fn(),
  signOutMember: vi.fn(),
  returnMemberRental: vi.fn(),
  fetchMemberState: vi.fn(),
  fetchMemberHistory: vi.fn(),
  fetchTitleReviews: vi.fn(),
  fetchMemberReviewEligibility: vi.fn(),
  writeMemberReview: vi.fn(),
}));

const cache = vi.hoisted(() => ({
  readAllSeriesProgress: vi.fn(),
  readLocalSeriesEpisodes: vi.fn(),
}));

vi.mock('../src/platform/nativeBridge', () => native);
vi.mock('../src/locadora/localCache', () => cache);

import { MemberPanel } from '../src/components/MemberPanel';
import { normalizeDiscoveryTitle } from '../src/domain/content';

beforeEach(() => {
  cache.readAllSeriesProgress.mockResolvedValue([]);
  cache.readLocalSeriesEpisodes.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Locadora member panel', () => {
  it('opens watch-later, favorite, active and returned titles without changing rental state', async () => {
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    const title = (tmdbId: number, name: string) => ({ id: `item-${tmdbId}`, tmdbId, type: 'movie', name, year: 1999 });
    native.fetchMemberState.mockResolvedValue({
      profile: { userId: 'user-1', username: 'will' },
      activeRental: { id: 'rental', items: [title(1, 'Rented tape')] },
      collections: { watch_later: Array.from({ length: 6 }, (_, i) => title(10 + i, `Later ${i + 1}`)), favorite: [title(2, 'Favorite tape')] },
      history: [title(3, 'Returned tape')],
    });
    const inspect = vi.fn();
    const user = userEvent.setup();
    render(<MemberPanel locale="pt-BR" onInspect={inspect} />);
    await user.click(await screen.findByRole('button', { name: 'Inspecionar Rented tape' }));
    expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ identity: expect.objectContaining({ canonicalKey: 'movie:tmdb:1' }) }));
    expect(screen.queryByRole('button', { name: 'Inspecionar Later 4' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('region', { name: '＋ Assistir depois' })).getByRole('button', { name: 'Abrir lista (6)' }));
    await user.click(screen.getByRole('button', { name: 'Inspecionar Later 6' }));
    expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Later 6' }));
    await user.click(screen.getByRole('button', { name: 'Voltar à Carteirinha' }));
    await user.click(screen.getByRole('button', { name: 'Inspecionar Favorite tape' }));
    expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Favorite tape' }));
    await user.click(screen.getByText('Histórico da Locadora'));
    screen.getByRole('button', { name: 'Inspecionar Returned tape' }).focus();
    await user.keyboard('{Enter}');
    expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Returned tape' }));
    expect(native.returnMemberRental).not.toHaveBeenCalled();
    expect(native.writeMemberReview).not.toHaveBeenCalled();
  });

  it('creates an account and completes the separate public profile', async () => {
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: false, user: null });
    native.signUpMember.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.updateMemberProfile.mockResolvedValue({ profile: { userId: 'user-1', username: 'will' } });
    native.fetchMemberState.mockResolvedValue({
      profile: { userId: 'user-1', username: 'will', createdAt: '2026-09-22T00:00:00Z' },
      collections: { watch_later: [], favorite: [] },
      activeRental: null,
      history: [],
      historyHasMore: false,
    });
    const user = userEvent.setup();
    render(<MemberPanel locale="pt-BR" onInspect={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Criar conta' }));
    await user.type(screen.getByLabelText('Email'), 'member@example.invalid');
    await user.type(screen.getByLabelText('Nome público'), 'Will');
    await user.type(screen.getByLabelText('Senha'), 'secret-password');
    await user.type(screen.getByLabelText('Confirmar senha'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Criar Carteirinha' }));

    await waitFor(() => expect(native.signUpMember).toHaveBeenCalledWith('member@example.invalid', 'will', 'secret-password'));
    expect(native.updateMemberProfile).toHaveBeenCalledWith('will');
    expect(await screen.findByText('@will')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('secret-password')).not.toBeInTheDocument();
  });

  it('returns a tape only after an explicit watched-status choice', async () => {
    const item = {
      id: '11111111-1111-4111-8111-111111111111',
      canonicalKey: 'movie:603',
      tmdbId: 603,
      type: 'movie',
      name: 'The Matrix',
      year: 1999,
    };
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: { id: 'rental-1', items: [item] }, collections: {}, history: [] })
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: null, collections: {}, history: [{ ...item, returnedAt: '2026-09-22T00:00:00Z', watchedStatus: 'watched' }] });
    native.returnMemberRental.mockResolvedValue({ rentalItem: { id: item.id, watchedStatus: 'watched' } });
    native.fetchTitleReviews.mockResolvedValue({ summary: { averageRating: 0, ratingCount: 0 }, reviews: [] });
    native.fetchMemberReviewEligibility.mockResolvedValue({ eligible: true });
    const user = userEvent.setup();
    render(<MemberPanel locale="pt-BR" onInspect={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Assisti' }));

    expect(native.returnMemberRental).toHaveBeenCalledWith(item.id, 'watched');
    expect(await screen.findByText('Fita devolvida. Agora conta o que achou.')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Avaliação de The Matrix' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Avalie esta fita' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Sua resenha'), 'Ainda funciona.');
    await user.click(screen.getByRole('button', { name: 'Publicar avaliação' }));
    expect(native.writeMemberReview).toHaveBeenCalledWith('movie', 603, 5, 'Ainda funciona.');
    expect(screen.queryByRole('button', { name: 'Assisti' })).not.toBeInTheDocument();
  });

  it('paginates and deduplicates member history by rental item ID', async () => {
    const first = { id: '11111111-1111-4111-8111-111111111111', canonicalKey: 'movie:1', tmdbId: 1, type: 'movie', name: 'First Tape' };
    const second = { id: '22222222-2222-4222-8222-222222222222', canonicalKey: 'movie:2', tmdbId: 2, type: 'movie', name: 'Second Tape' };
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState.mockResolvedValue({ profile: { userId: 'user-1', username: 'will' }, activeRental: null, collections: {}, history: [first], historyHasMore: true });
    native.fetchMemberHistory.mockResolvedValue({ history: [first, second], hasMore: false });
    const user = userEvent.setup();
    render(<MemberPanel locale="pt-BR" onInspect={vi.fn()} />);

    await user.click(await screen.findByText('Histórico da Locadora'));
    await user.click(screen.getByRole('button', { name: 'Carregar histórico' }));

    expect(native.fetchMemberHistory).toHaveBeenCalledWith(1);
    expect(await screen.findByText('Second Tape')).toBeInTheDocument();
    expect(screen.getAllByText('First Tape')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Carregar histórico' })).not.toBeInTheDocument();
  });

  it('keeps the web block order and signs in and out through the existing APIs', async () => {
    native.readMemberSession.mockResolvedValueOnce({ configured: true, signedIn: false, user: null });
    native.signInMember.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState.mockResolvedValue({
      profile: { userId: 'user-1', username: 'will', rentalLimit: 3 },
      activeRental: null,
      collections: {},
      history: [],
    });
    native.signOutMember.mockResolvedValue({ configured: true, signedIn: false, user: null });
    const user = userEvent.setup();
    render(<MemberPanel locale="en-US" onInspect={vi.fn()} />);

    await user.type(await screen.findByLabelText('Email or username'), 'will');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(native.signInMember).toHaveBeenCalledWith('will', 'secret-password');

    const blocks = [
      await screen.findByRole('region', { name: 'Membership details' }),
      screen.getByRole('region', { name: 'Rental limit' }),
      screen.getByRole('region', { name: 'Account summary' }),
      screen.getByRole('region', { name: 'Personal shelves' }),
      screen.getByRole('region', { name: 'Active rentals' }),
      screen.getByRole('group', { name: 'Locadora history' }),
      screen.getByRole('button', { name: 'Sign out of Locadora' }),
    ];
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index - 1].compareDocumentPosition(blocks[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    await user.click(blocks.at(-1)!);
    expect(native.signOutMember).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('saves an inline username edit through the existing profile call', async () => {
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, collections: {}, history: [] })
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will_rewind' }, collections: {}, history: [] });
    const user = userEvent.setup();
    render(<MemberPanel locale="en-US" onInspect={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Edit username' }));
    const input = screen.getByLabelText('Public username');
    await user.clear(input);
    await user.type(input, 'Will_Rewind');
    await user.click(screen.getByRole('button', { name: 'Save username' }));

    expect(native.updateMemberProfile).toHaveBeenCalledWith('will_rewind');
    expect(await screen.findByText('@will_rewind')).toBeInTheDocument();
  });

  it.each([
    ['Não assisti', 'not_watched'],
    ['Não dizer', 'unknown'],
  ] as const)('returns through the %s outcome without changing the payload', async (button, status) => {
    const item = { id: '11111111-1111-4111-8111-111111111111', tmdbId: 603, type: 'movie', name: 'The Matrix' };
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: { id: 'rental-1', items: [item] }, collections: {}, history: [] })
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: null, collections: {}, history: [item] });
    const user = userEvent.setup();
    render(<MemberPanel locale="pt-BR" onInspect={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: button }));
    expect(native.returnMemberRental).toHaveBeenCalledWith(item.id, status);
  });

  it('shows the cached next episode for local progress and opens the canonical series inspection', async () => {
    const series = normalizeDiscoveryTitle({
      tmdbId: 1399,
      imdbId: 'tt0944947',
      type: 'series',
      name: 'Game of Thrones',
      year: 2011,
    })!;
    cache.readAllSeriesProgress.mockResolvedValue([{
      seriesId: 'tt0944947',
      season: 1,
      episode: 1,
      watched: { '1:1': '2026-10-19T12:00:00.000Z' },
      updatedAt: '2026-10-19T12:00:00.000Z',
    }]);
    cache.readLocalSeriesEpisodes.mockResolvedValue({ seasons: [{ season: 1, episodes: [
      { season: 1, episode: 1, name: 'Winter Is Coming' },
      { season: 1, episode: 2, name: 'The Kingsroad' },
    ] }] });
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState.mockResolvedValue({ profile: { userId: 'user-1', username: 'will' }, collections: {}, history: [] });
    const inspect = vi.fn();
    const user = userEvent.setup();
    render(<MemberPanel locale="pt-BR" onInspect={inspect} knownTitles={[series]} />);

    const shelf = await screen.findByRole('region', { name: '▶ Continuar assistindo' });
    expect(within(shelf).getByText('T01E02 · The Kingsroad')).toBeInTheDocument();
    await user.click(within(shelf).getByRole('button', { name: 'Inspecionar Game of Thrones' }));
    expect(inspect).toHaveBeenCalledWith(series);
    expect(cache.readLocalSeriesEpisodes).toHaveBeenCalledWith('tt0944947');
  });

  it('omits the continue-watching block when there is no local progress', async () => {
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState.mockResolvedValue({ profile: { userId: 'user-1', username: 'will' }, collections: {}, history: [] });
    render(<MemberPanel locale="pt-BR" onInspect={vi.fn()} />);

    await screen.findByRole('region', { name: 'Prateleiras pessoais' });
    await waitFor(() => expect(cache.readAllSeriesProgress).toHaveBeenCalledOnce());
    expect(screen.queryByRole('region', { name: '▶ Continuar assistindo' })).not.toBeInTheDocument();
    expect(cache.readLocalSeriesEpisodes).not.toHaveBeenCalled();
  });
});

it('saves the account rental limit and keeps the confirmed value on failure', async () => {
  native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1' } });
  native.fetchMemberState.mockResolvedValue({ profile: { userId: 'user-1', username: 'will', rentalLimit: 3 } });
  const user = userEvent.setup();
  render(<MemberPanel locale="en-US" onInspect={vi.fn()} />);
  const select = await screen.findByLabelText('Simultaneous rental limit');
  expect(screen.getAllByRole('option')).toHaveLength(10);
  native.updateMemberRentalLimit.mockResolvedValue({ rentalLimit: 10 });
  native.fetchMemberState.mockResolvedValue({ profile: { userId: 'user-1', username: 'will', rentalLimit: 10 } });
  await user.selectOptions(select, '10');
  expect(native.updateMemberRentalLimit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save limit' }));
  await screen.findByText('Rental limit saved.');
  expect(native.updateMemberRentalLimit).toHaveBeenCalledWith(10);
  expect(select).toHaveValue('10');
  native.updateMemberRentalLimit.mockRejectedValue(new Error('Offline'));
  await user.selectOptions(select, '1');
  await user.click(screen.getByRole('button', { name: 'Save limit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(select).toHaveValue('10');
});
