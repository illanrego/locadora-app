// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_TITLES } from '../src/locadora/fixture';

const native = vi.hoisted(() => ({
  readMemberSession: vi.fn(),
  fetchMemberState: vi.fn(),
  createMemberRental: vi.fn(),
}));

vi.mock('../src/platform/nativeBridge', () => native);

import { BasketPanel } from '../src/components/BasketPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Balcão checkout', () => {
  it('requires member state at checkout and refreshes it after a successful rental', async () => {
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: null, collections: {}, history: [] })
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: { id: 'rental-1', items: [] }, collections: {}, history: [] });
    native.createMemberRental.mockResolvedValue({ rental: { id: 'rental-1' } });
    const complete = vi.fn();
    const user = userEvent.setup();
    render(<BasketPanel locale="pt-BR" basket={[FIXTURE_TITLES[0]]} onRemove={vi.fn()} onComplete={complete} onOpenAccount={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Alugar/ }));

    expect(native.createMemberRental).toHaveBeenCalledWith([{ tmdbId: 101, contentType: 'movie', name: 'Big Buck Bunny', year: 2008 }]);
    expect(native.fetchMemberState).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledWith([FIXTURE_TITLES[0]]);
    expect(await screen.findByText('Aluguel confirmado. Boa sessão!')).toBeInTheDocument();
  });

  it('rents only the tapes that stay selected', async () => {
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberState
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: null, collections: {}, history: [] })
      .mockResolvedValueOnce({ profile: { userId: 'user-1', username: 'will' }, activeRental: { id: 'rental-1', items: [] }, collections: {}, history: [] });
    native.createMemberRental.mockResolvedValue({ rental: { id: 'rental-1' } });
    const user = userEvent.setup();
    render(<BasketPanel locale="pt-BR" basket={[FIXTURE_TITLES[0], FIXTURE_TITLES[1]]} onRemove={vi.fn()} onComplete={vi.fn()} onOpenAccount={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: /Big Buck Bunny/ }));
    await user.click(screen.getByRole('button', { name: /^Alugar/ }));

    expect(native.createMemberRental).toHaveBeenCalledWith([expect.objectContaining({ name: FIXTURE_TITLES[1].name })]);
  });
});
