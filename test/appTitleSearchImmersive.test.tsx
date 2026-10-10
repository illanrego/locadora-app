// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../src/components/ImmersiveShelf', () => ({ default: () => <div id="immersive-shelf" /> }));
import App from '../src/App';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

it('keeps title search reachable inside the immersive filter menu', async () => {
  window.localStorage.setItem('locadora:immersive:v2:enabled', 'true');
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByRole('button', { name: 'Buscar fitas' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buscar título' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Buscar fitas' }));
  await user.click(screen.getByRole('button', { name: 'Buscar título' }));
  expect(within(screen.getByRole('dialog', { name: 'Buscar título' })).getByRole('searchbox')).toBeInTheDocument();
});
