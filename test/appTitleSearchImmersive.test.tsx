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

it('removes duplicate genre and year controls from the immersive filter menu', async () => {
  window.localStorage.setItem('locadora:immersive:v2:enabled', 'true');
  const user = userEvent.setup();
  const { container } = render(<App />);
  const trigger = screen.getByRole('button', { name: 'Buscar fitas' });
  expect(trigger).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buscar título' })).not.toBeInTheDocument();
  await user.click(trigger);
  expect(trigger).toHaveFocus();
  expect(container.querySelector('.browse-controls')).not.toHaveAttribute('hidden');
  expect(container.querySelector('.genre-picker')).not.toBeInTheDocument();
  expect(container.querySelector('.year-machine')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ano da loja' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Buscar título' }));
  expect(within(screen.getByRole('dialog', { name: 'Buscar título' })).getByRole('searchbox')).toBeInTheDocument();
});

it('keeps the 2D genre and year controls on their one-load apply paths', async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  await waitFor(() => expect(discovery.loadShelf).toHaveBeenCalledTimes(1));

  const genre = screen.getByRole('combobox', { name: 'Gênero' });
  const year = screen.getByRole('button', { name: 'Ano da loja' });
  expect(container.querySelector('.genre-picker')).toBe(genre);
  expect(container.querySelector('.year-machine')).toBeInTheDocument();

  await user.selectOptions(genre, '1');
  await waitFor(() => expect(discovery.loadShelf).toHaveBeenCalledTimes(2));
  expect(discovery.loadShelf).toHaveBeenLastCalledWith(expect.objectContaining({ genres: ['Comedy'] }), expect.any(AbortSignal));

  await user.click(year);
  await user.click(within(screen.getByRole('listbox', { name: 'Ano da loja' })).getByRole('option', { name: '1998' }));
  expect(discovery.loadShelf).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: 'Ir' }));
  await waitFor(() => expect(discovery.loadShelf).toHaveBeenCalledTimes(3));
  expect(discovery.loadShelf).toHaveBeenLastCalledWith(expect.objectContaining({ genres: ['Comedy'], year: 1998 }), expect.any(AbortSignal));
});
