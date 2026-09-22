// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); },
  });
});

afterEach(() => cleanup());
beforeEach(() => window.localStorage.clear());

describe('accessible Locadora shelf', () => {
  it('renders the normal shelf without provider or Stremio catalogue controls', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Ação e aventura' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Inspecionar Agent 327/i })).toBeInTheDocument();
    expect(screen.queryByText(/Seus streamings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stremio catalogue/i)).not.toBeInTheDocument();
    expect(screen.getByText('Acervo de demonstração')).toBeInTheDocument();
  });

  it('inspects a tape and adds it to the independent Cesta', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Inspecionar Agent 327/i }));
    const dialog = screen.getByRole('dialog', { name: /Agent 327/i });
    expect(within(dialog).getByRole('button', { name: 'Assistir — integração em desenvolvimento' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Colocar na Cesta' }));
    expect(screen.getByLabelText('1 / 3')).toBeInTheDocument();
  });

  it('keeps series in manual-development mode and switches locale', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ajustes' }));
    await user.click(screen.getByRole('button', { name: 'Séries' }));
    expect(await screen.findByRole('button', { name: /Inspecionar The Flash/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'English' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument());
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('filters the current shelf by title without losing keyboard buttons', async () => {
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('searchbox', { name: 'Pesquisar na estante' });
    await user.type(search, 'train');
    expect(await screen.findByRole('button', { name: /The Great Train Robbery/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agent 327/i })).not.toBeInTheDocument();
  });

  it('keeps media configuration in secondary settings and desktop-only', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ajustes' }));
    await user.click(screen.getByRole('button', { name: 'Fontes de mídia' }));
    const dialog = screen.getByRole('dialog', { name: 'Fontes de mídia' });
    expect(within(dialog).getByText('Abra o aplicativo desktop para usar o cofre do sistema.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Manifest URL')).not.toBeInTheDocument();
  });

  it('keeps Quick Watch automatic by default and persists an explicit opt-out', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ajustes' }));
    const toggle = screen.getByRole('button', { name: 'Quick Watch automático' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    first.unmount();

    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ajustes' }));
    expect(screen.getByRole('button', { name: 'Quick Watch automático' })).toHaveAttribute('aria-pressed', 'false');
  });
});
