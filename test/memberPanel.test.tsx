// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  readMemberSession: vi.fn(),
  signInMember: vi.fn(),
  signUpMember: vi.fn(),
  updateMemberProfile: vi.fn(),
  signOutMember: vi.fn(),
  returnMemberRental: vi.fn(),
  fetchMemberState: vi.fn(),
}));

vi.mock('../src/platform/nativeBridge', () => native);

import { MemberPanel } from '../src/components/MemberPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Locadora member panel', () => {
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
    render(<MemberPanel locale="pt-BR" />);

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
    const user = userEvent.setup();
    render(<MemberPanel locale="pt-BR" />);

    await user.click(await screen.findByRole('button', { name: 'Assisti' }));

    expect(native.returnMemberRental).toHaveBeenCalledWith(item.id, 'watched');
    expect(await screen.findByText('Fita devolvida e histórico atualizado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assisti' })).not.toBeInTheDocument();
  });
});
