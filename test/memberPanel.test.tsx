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
});
