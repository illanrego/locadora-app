// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { normalizeDiscoveryTitle } from '../src/domain/content';

const { loadShelf, loadTitleDetails, loadPerson, loadCreditStand } = vi.hoisted(() => ({
  loadShelf: vi.fn(), loadTitleDetails: vi.fn(), loadPerson: vi.fn(), loadCreditStand: vi.fn(),
}));
vi.mock('../src/locadora/discovery', () => ({ loadShelf, loadTitleDetails, loadPerson, loadCreditStand }));
vi.mock('../src/components/VhsInspection', () => ({ VhsInspection: () => <div /> }));
import App from '../src/App';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); });

it('moves from an inspector credit to a person stand and back to the aisle', async () => {
  const aisleTitle = normalizeDiscoveryTitle({ id: 'tmdb:680', type: 'movie', name: 'Pulp Fiction', year: 1994 })!;
  const detailed = normalizeDiscoveryTitle({ id: 'tmdb:680', type: 'movie', name: 'Pulp Fiction', year: 1994,
    director: ['Quentin Tarantino'], credits: { director: [{ id: '138', name: 'Quentin Tarantino' }] } })!;
  const series = normalizeDiscoveryTitle({ id: 'tmdb:100', type: 'series', name: 'Example series', year: 2001 })!;
  loadShelf.mockResolvedValue({ titles: [aisleTitle], hasNextStand: false, source: 'fixture' });
  loadTitleDetails.mockResolvedValue(detailed);
  loadPerson.mockResolvedValue({ id: '138', name: 'Quentin Tarantino', profile: null, knownFor: 'Directing', roles: [{ department: 'Directing', count: 12 }] });
  loadCreditStand.mockResolvedValue({ titles: [series], hasNextStand: false, source: 'public-api' });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /Inspecionar Pulp Fiction/ }));
  const inspection = screen.getByRole('dialog', { name: 'Pulp Fiction' });
  await user.click(within(inspection).getByText('Créditos da fita'));
  await user.click(await within(inspection).findByRole('button', { name: 'Quentin Tarantino' }));
  const person = await screen.findByRole('dialog', { name: 'Créditos de Quentin Tarantino' });
  expect(loadPerson).toHaveBeenCalledWith('138', 'pt-BR', expect.any(AbortSignal));
  expect(await within(person).findByText('Example series')).toBeInTheDocument();
  await user.click(within(person).getByRole('button', { name: 'Ver como estante' }));
  expect(await screen.findByRole('heading', { name: 'Estante: Quentin Tarantino' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Inspecionar Example series/ })).toBeInTheDocument();
  expect(loadCreditStand).toHaveBeenCalledWith(expect.objectContaining({ credit: expect.objectContaining({ id: '138', department: 'Directing' }), stand: 0 }), expect.any(AbortSignal));
  await user.click(screen.getByRole('button', { name: 'Voltar ao corredor' }));
  expect(await screen.findByRole('heading', { name: 'Ação e aventura' })).toBeInTheDocument();
  expect(loadShelf).toHaveBeenCalledTimes(2);
});
