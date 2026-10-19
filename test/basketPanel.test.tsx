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

const tapes = vi.hoisted(() => ({
  offerConfirmedRentalToTapes: vi.fn(),
  releaseReturnedTape: vi.fn(),
}));

vi.mock('../src/platform/nativeBridge', () => native);
vi.mock('../src/rentals/rentalTapePipeline', () => tapes);

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
    expect(tapes.offerConfirmedRentalToTapes).toHaveBeenCalledWith({ rental: { id: 'rental-1' } }, [FIXTURE_TITLES[0]]);
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

it.each([1, 3, 10])('enforces the current account limit of %s at checkout', async (rentalLimit) => {
  native.readMemberSession.mockResolvedValue({ signedIn: true });
  native.fetchMemberState.mockResolvedValue({ profile: { userId: 'user', username: 'will', rentalLimit },
    activeRental: { id: 'rental', items: Array.from({ length: rentalLimit }, (_, i) => ({ tmdbId: i + 500, type: 'movie', name: `Rented ${i}` })) } });
  const user = userEvent.setup();
  render(<BasketPanel locale="en-US" basket={[FIXTURE_TITLES[0]]} onRemove={vi.fn()} onComplete={vi.fn()} onOpenAccount={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /^Rent/ }));
  expect(await screen.findByRole('status')).toHaveTextContent(`Your limit is ${rentalLimit}`);
  expect(native.createMemberRental).not.toHaveBeenCalled();
  expect(tapes.offerConfirmedRentalToTapes).not.toHaveBeenCalled();
});

it('allows a fourth rental when the member has chosen ten', async () => {
  native.readMemberSession.mockResolvedValue({ signedIn: true });
  native.fetchMemberState.mockResolvedValue({ profile: { userId: 'user', username: 'will', rentalLimit: 10 },
    activeRental: { id: 'rental', items: Array.from({ length: 3 }, (_, i) => ({ tmdbId: i + 500, type: 'movie', name: `Rented ${i}` })) } });
  native.createMemberRental.mockResolvedValue({});
  const user = userEvent.setup();
  render(<BasketPanel locale="en-US" basket={[FIXTURE_TITLES[0]]} onRemove={vi.fn()} onComplete={vi.fn()} onOpenAccount={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /^Rent/ }));
  expect(await screen.findByText('Rental confirmed. Enjoy the show!')).toBeInTheDocument();
  expect(native.createMemberRental).toHaveBeenCalledOnce();
});
