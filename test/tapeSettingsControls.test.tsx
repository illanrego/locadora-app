// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TapeSettingsGroup } from '../src/components/TapeSettingsGroup';
import {
  DEFAULT_TAPE_SETTINGS,
  TAPE_SETTINGS_KEYS,
  readTapeSettings,
} from '../src/rentals/tapeSettings';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('rented-tape settings group', () => {
  it('shows the four documented defaults from tapeSettings', () => {
    render(<TapeSettingsGroup locale="pt-BR" />);

    const group = screen.getByRole('group', { name: 'Fitas alugadas' });
    expect(within(group).getByRole('checkbox', { name: 'Baixar e guardar fitas alugadas' })).toBeChecked();
    expect(within(group).getByLabelText('Espaço para fitas (GB)')).toHaveValue(DEFAULT_TAPE_SETTINGS.maxGb);
    expect(within(group).getByLabelText('Proporção de envio')).toHaveValue(DEFAULT_TAPE_SETTINGS.ratio);
    expect(within(group).getByLabelText('Porta de pares')).toHaveValue(DEFAULT_TAPE_SETTINGS.peerPort);
    expect(DEFAULT_TAPE_SETTINGS).toEqual({ enabled: true, maxGb: 6, ratio: 0, peerPort: 6881 });
    expect(readTapeSettings()).toEqual(DEFAULT_TAPE_SETTINGS);
    // Reading the controls never writes a key.
    expect(Object.keys(window.localStorage)).toHaveLength(0);
  });

  it('round-trips all four keys through tapeSettings, including the documented zeros', async () => {
    const user = userEvent.setup();
    render(<TapeSettingsGroup locale="pt-BR" />);
    const group = screen.getByRole('group', { name: 'Fitas alugadas' });

    await user.click(within(group).getByRole('checkbox', { name: 'Baixar e guardar fitas alugadas' }));
    expect(readTapeSettings().enabled).toBe(false);
    expect(window.localStorage.getItem(TAPE_SETTINGS_KEYS.enabled)).toBe('false');

    const maxGb = within(group).getByLabelText('Espaço para fitas (GB)') as HTMLInputElement;
    await user.clear(maxGb);
    await user.type(maxGb, '0');
    await user.tab();
    expect(readTapeSettings().maxGb).toBe(0);
    expect(window.localStorage.getItem(TAPE_SETTINGS_KEYS.maxGb)).toBe('0');

    const ratio = within(group).getByLabelText('Proporção de envio') as HTMLInputElement;
    await user.clear(ratio);
    await user.type(ratio, '1.5{Enter}');
    expect(readTapeSettings().ratio).toBe(1.5);
    expect(window.localStorage.getItem(TAPE_SETTINGS_KEYS.ratio)).toBe('1.5');

    const peerPort = within(group).getByLabelText('Porta de pares') as HTMLInputElement;
    await user.clear(peerPort);
    await user.type(peerPort, '0');
    await user.tab();
    expect(readTapeSettings()).toEqual({ enabled: false, maxGb: 0, ratio: 1.5, peerPort: 0 });
    expect(window.localStorage.getItem(TAPE_SETTINGS_KEYS.peerPort)).toBe('0');
    expect(Object.keys(window.localStorage).sort()).toEqual(Object.values(TAPE_SETTINGS_KEYS).sort());
  });

  it('is fully keyboard reachable in drawer order and keeps accessible names', async () => {
    const user = userEvent.setup();
    render(<TapeSettingsGroup locale="pt-BR" />);
    const group = screen.getByRole('group', { name: 'Fitas alugadas' });

    const checkbox = within(group).getByRole('checkbox', { name: 'Baixar e guardar fitas alugadas' });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    await user.tab();
    expect(within(group).getByLabelText('Espaço para fitas (GB)')).toHaveFocus();
    await user.tab();
    expect(within(group).getByLabelText('Proporção de envio')).toHaveFocus();
    await user.tab();
    expect(within(group).getByLabelText('Porta de pares')).toHaveFocus();

    expect(within(group).getByLabelText('Proporção de envio')).toHaveAttribute(
      'aria-describedby', 'tape-setting-ratio-hint',
    );
    expect(within(group).getByLabelText('Porta de pares')).toHaveAttribute(
      'aria-describedby', 'tape-setting-peer-port-hint',
    );
    expect(group).toHaveAttribute('aria-describedby', 'tape-settings-next-start');
  });

  it('says that ratio and peer port apply at the next start, without offering a restart', () => {
    render(<TapeSettingsGroup locale="pt-BR" />);
    expect(screen.getByText('Proporção e porta de pares passam a valer no próximo início do compartilhamento.'))
      .toBeInTheDocument();
    expect(screen.getByText('0 = sem limite. Passa a valer no próximo início.')).toBeInTheDocument();
    expect(screen.getByText('0 = porta aleatória. Passa a valer no próximo início.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reiniciar|restart/i })).not.toBeInTheDocument();
  });

  it('reverts an empty or invalid entry to the accepted value instead of persisting a surprise', async () => {
    const user = userEvent.setup();
    render(<TapeSettingsGroup locale="pt-BR" />);
    const peerPort = screen.getByLabelText('Porta de pares') as HTMLInputElement;

    await user.clear(peerPort);
    await user.tab();
    expect(peerPort).toHaveValue(6881);
    expect(readTapeSettings()).toEqual(DEFAULT_TAPE_SETTINGS);

    await user.clear(peerPort);
    await user.type(peerPort, '70000');
    await user.tab();
    expect(peerPort).toHaveValue(6881); // out of range normalizes to the default
    expect(readTapeSettings().peerPort).toBe(6881);
  });

  it('uses the English labels in en-US', () => {
    render(<TapeSettingsGroup locale="en-US" />);
    const group = screen.getByRole('group', { name: 'Rented tapes' });
    expect(within(group).getByRole('checkbox', { name: 'Download and keep rented tapes' })).toBeChecked();
    expect(within(group).getByLabelText('Space for tapes (GB)')).toHaveValue(6);
    expect(within(group).getByLabelText('Share ratio')).toHaveValue(0);
    expect(within(group).getByLabelText('Peer port')).toHaveValue(6881);
    expect(within(group).getByText('Ratio and peer port apply the next time sharing starts.')).toBeInTheDocument();
  });
});
