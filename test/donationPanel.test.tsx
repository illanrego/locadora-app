// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DonationPanel } from '../src/components/DonationPanel';

afterEach(() => cleanup());
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

describe('voluntary Locadora support', () => {
  it('copies the public Pix payload without creating payment or rental state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<DonationPanel locale="pt-BR" onClose={vi.fn()} />);

    expect(screen.getByText('A LOCADORA É GRÁTIS')).toBeInTheDocument();
    expect(screen.getByText('A Locadora não recebe nem guarda confirmação de pagamento.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copiar código Pix' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(await screen.findByText('Código Pix copiado!')).toBeInTheDocument();
  });
});
