// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const scene = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/components/ImmersiveShelf', () => ({ default: ({ onReady, onFailure, onInspect, titles }: {
  onReady(): void; onFailure(): void; onInspect(title: unknown): void; titles: unknown[];
}) => {
  useEffect(() => { if (scene.fail) onFailure(); else onReady(); }, [onFailure, onReady]);
  return <button onClick={() => onInspect(titles[0])}>Scene tape</button>;
} }));
import App from '../src/App';
beforeEach(() => {
  localStorage.clear(); scene.fail = false;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
});
afterEach(cleanup);
describe('exclusive immersive store', () => {
  it('replaces the normal rack and restores it with the same catalogue', async () => {
    const view = render(<App />);
    await screen.findByRole('button', { name: /Inspecionar Agent 327/i });
    fireEvent.click(screen.getByRole('button', { name: 'Modo imersivo' }));
    await screen.findByRole('button', { name: 'Scene tape' });
    expect(view.container.querySelector('.shelf-room')).toBeNull();
    expect(view.container.querySelector('footer')).toBeNull();
    expect(screen.queryByRole('button', { name: /Inspecionar Agent 327/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Modo 2D' }));
    expect(await screen.findByRole('button', { name: /Inspecionar Agent 327/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scene tape' })).not.toBeInTheDocument();
  });
  it('returns to usable 2D browsing when the scene fails', async () => {
    scene.fail = true;
    render(<App />);
    await screen.findByRole('button', { name: /Inspecionar Agent 327/i });
    fireEvent.click(screen.getByRole('button', { name: 'Modo imersivo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Modo imersivo' })).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByText(/O modo imersivo não abriu/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Inspecionar Agent 327/i })).toBeInTheDocument();
  });
});
