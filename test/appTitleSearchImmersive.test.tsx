// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/components/ImmersiveShelf', () => ({ default: () => <div id="immersive-shelf" /> }));
const discovery = vi.hoisted(() => ({
  loadCreditStand: vi.fn(),
  loadShelf: vi.fn(),
  loadTitleDetails: vi.fn(),
}));
vi.mock('../src/locadora/discovery', () => discovery);
import App from '../src/App';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
});
beforeEach(() => {
  window.localStorage.clear();
  discovery.loadShelf.mockResolvedValue({ titles: [], hasNextStand: false, source: 'fixture' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('opens the title search directly in immersive mode, with no browse panel or sort control', async () => {
  window.localStorage.setItem('locadora:immersive:v2:enabled', 'true');
  const user = userEvent.setup();
  const { container } = render(<App />);
  const search = screen.getByRole('button', { name: 'Buscar título' });
  expect(search).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buscar fitas' })).not.toBeInTheDocument();
  expect(container.querySelector('.browse-controls')).not.toBeInTheDocument();
  expect(container.querySelector('.sort-picker')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Ordenar por' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Gênero' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ano da loja' })).not.toBeInTheDocument();
  await user.click(search);
  expect(within(screen.getByRole('dialog', { name: 'Buscar título' })).getByRole('searchbox')).toBeInTheDocument();
});

it('keeps the 2D genre, year and sort controls on their one-load apply paths', async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  await waitFor(() => expect(discovery.loadShelf).toHaveBeenCalledTimes(1));

  const genre = screen.getByRole('combobox', { name: 'Gênero' });
  const year = screen.getByRole('button', { name: 'Ano da loja' });
  const sortPicker = screen.getByRole('combobox', { name: 'Ordenar por' });
  expect(container.querySelector('.browse-controls')).toContainElement(genre);
  expect(container.querySelector('.genre-picker')).toBe(genre);
  expect(container.querySelector('.year-machine')).toBeInTheDocument();
  expect(container.querySelector('.sort-picker')).toContainElement(sortPicker);

  await user.selectOptions(genre, '1');
  await waitFor(() => expect(discovery.loadShelf).toHaveBeenCalledTimes(2));
  expect(discovery.loadShelf).toHaveBeenLastCalledWith(expect.objectContaining({ genres: ['Comedy'] }), expect.any(AbortSignal));

  await user.click(year);
  await user.click(within(screen.getByRole('listbox', { name: 'Ano da loja' })).getByRole('option', { name: '1998' }));
  expect(discovery.loadShelf).toHaveBeenCalledTimes(2);
  await user.selectOptions(sortPicker, 'rating');
  expect(discovery.loadShelf).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: 'Ir' }));
  await waitFor(() => expect(discovery.loadShelf).toHaveBeenCalledTimes(3));
  expect(discovery.loadShelf).toHaveBeenLastCalledWith(expect.objectContaining({ genres: ['Comedy'], year: 1998, sort: 'rating' }), expect.any(AbortSignal));
});
