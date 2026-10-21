// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TapeSettingsGroup } from '../src/components/TapeSettingsGroup';
import {
  DEFAULT_TAPE_SETTINGS,
  readTapeSettings,
} from '../src/rentals/tapeSettings';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('rented-tape settings group', () => {
  it('keeps only the tape master switch in the settings group', () => {
    render(<TapeSettingsGroup locale="pt-BR" />);

    const group = screen.getByRole('group', { name: 'Fitas alugadas' });
    expect(within(group).getByRole('checkbox', { name: 'Baixar e guardar fitas alugadas' })).toBeChecked();
    expect(within(group).queryByLabelText('Espaço para fitas (GB)')).not.toBeInTheDocument();
    expect(within(group).queryByLabelText('Proporção de envio')).not.toBeInTheDocument();
    expect(within(group).queryByLabelText('Porta de pares')).not.toBeInTheDocument();
    expect(within(group).queryByText(/próximo início/i)).not.toBeInTheDocument();
    expect(DEFAULT_TAPE_SETTINGS).toEqual({ enabled: true, maxGb: 6, ratio: 0, peerPort: 6881 });
    expect(readTapeSettings()).toEqual(DEFAULT_TAPE_SETTINGS);
    // Reading the controls never writes a key.
    expect(Object.keys(window.localStorage)).toHaveLength(0);
  });

  it('writes the master switch without changing the hidden or relocated values', async () => {
    const user = userEvent.setup();
    render(<TapeSettingsGroup locale="pt-BR" />);
    const group = screen.getByRole('group', { name: 'Fitas alugadas' });

    await user.click(within(group).getByRole('checkbox', { name: 'Baixar e guardar fitas alugadas' }));
    expect(readTapeSettings()).toEqual({ ...DEFAULT_TAPE_SETTINGS, enabled: false });
  });

  it('keeps the master switch keyboard reachable and labelled', () => {
    render(<TapeSettingsGroup locale="pt-BR" />);
    const group = screen.getByRole('group', { name: 'Fitas alugadas' });

    const checkbox = within(group).getByRole('checkbox', { name: 'Baixar e guardar fitas alugadas' });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
  });

  it('uses the English labels in en-US', () => {
    render(<TapeSettingsGroup locale="en-US" />);
    const group = screen.getByRole('group', { name: 'Rented tapes' });
    expect(within(group).getByRole('checkbox', { name: 'Download and keep rented tapes' })).toBeChecked();
    expect(within(group).queryByLabelText('Space for tapes (GB)')).not.toBeInTheDocument();
    expect(within(group).queryByLabelText('Share ratio')).not.toBeInTheDocument();
    expect(within(group).queryByLabelText('Peer port')).not.toBeInTheDocument();
  });
});
