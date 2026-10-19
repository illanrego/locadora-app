/**
 * P6: the four `locadora.tapes.*` controls, as their own group inside the
 * existing settings drawer (§20).
 *
 * Every control reads and writes through `tapeSettings`, which is the single
 * local store: the master switch, the GB ceiling (`0` = no ceiling), the ratio
 * (`0` = unlimited) and the peer port (`0` = random each start). Nothing here
 * starts, stops or restarts an engine.
 *
 * Ratio and peer port are read by the tape engine at spawn, so a live engine
 * keeps the values it started with. The user is told that in the group note and
 * in each field's hint; no restart path is invented to make the change instant.
 *
 * Number fields commit on blur or Enter, and keep the typed text in between.
 * That keeps "0.5" typeable and also lets an invalid entry fall back to the
 * accepted value instead of persisting a normalized surprise mid-keystroke.
 */
import { useState } from 'react';
import type { Locale } from '../locadora/catalog';
import { readTapeSettings, writeTapeSettings, type TapeSettings } from '../rentals/tapeSettings';

type NumericKey = 'maxGb' | 'ratio' | 'peerPort';

interface TapeSettingsGroupProps {
  locale: Locale;
}

function draftsOf(settings: TapeSettings): Record<NumericKey, string> {
  return {
    maxGb: String(settings.maxGb),
    ratio: String(settings.ratio),
    peerPort: String(settings.peerPort),
  };
}

export function TapeSettingsGroup({ locale }: TapeSettingsGroupProps) {
  const pt = locale === 'pt-BR';
  const [settings, setSettings] = useState<TapeSettings>(() => readTapeSettings());
  const [drafts, setDrafts] = useState<Record<NumericKey, string>>(() => draftsOf(readTapeSettings()));

  function persist(patch: Partial<TapeSettings>): TapeSettings {
    // Re-read before every write so two quick controls can never write a stale
    // snapshot over each other; the store normalizes the merged result.
    const accepted = writeTapeSettings({ ...readTapeSettings(), ...patch });
    setSettings(accepted);
    return accepted;
  }

  function commit(key: NumericKey) {
    const raw = drafts[key].trim();
    const parsed = raw === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDrafts((current) => ({ ...current, [key]: String(settings[key]) }));
      return;
    }
    const accepted = persist({ [key]: parsed });
    setDrafts((current) => ({ ...current, [key]: String(accepted[key]) }));
  }

  return (
    <fieldset className="tape-settings-group" aria-describedby="tape-settings-next-start">
      <legend>{pt ? 'Fitas alugadas' : 'Rented tapes'}</legend>

      <label className="tape-settings-toggle" htmlFor="tape-setting-enabled">
        <input
          id="tape-setting-enabled"
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => persist({ enabled: event.target.checked })}
        />
        <span>{pt ? 'Baixar e guardar fitas alugadas' : 'Download and keep rented tapes'}</span>
      </label>
      <p className="tape-settings-hint">
        {pt ? 'Desligado, nada é baixado nem compartilhado.' : 'When off, nothing is downloaded or shared.'}
      </p>

      <label htmlFor="tape-setting-max-gb">{pt ? 'Espaço para fitas (GB)' : 'Space for tapes (GB)'}</label>
      <input
        id="tape-setting-max-gb"
        type="number"
        min={0}
        step={0.5}
        inputMode="decimal"
        value={drafts.maxGb}
        aria-describedby="tape-setting-max-gb-hint"
        onChange={(event) => setDrafts((current) => ({ ...current, maxGb: event.target.value }))}
        onBlur={() => commit('maxGb')}
        onKeyDown={(event) => { if (event.key === 'Enter') commit('maxGb'); }}
      />
      <p id="tape-setting-max-gb-hint" className="tape-settings-hint">
        {pt ? '0 = sem limite de espaço.' : '0 = no storage limit.'}
      </p>

      <label htmlFor="tape-setting-ratio">{pt ? 'Proporção de envio' : 'Share ratio'}</label>
      <input
        id="tape-setting-ratio"
        type="number"
        min={0}
        step={0.1}
        inputMode="decimal"
        value={drafts.ratio}
        aria-describedby="tape-setting-ratio-hint"
        onChange={(event) => setDrafts((current) => ({ ...current, ratio: event.target.value }))}
        onBlur={() => commit('ratio')}
        onKeyDown={(event) => { if (event.key === 'Enter') commit('ratio'); }}
      />
      <p id="tape-setting-ratio-hint" className="tape-settings-hint">
        {pt ? '0 = sem limite. Passa a valer no próximo início.' : '0 = unlimited. Applies from the next start.'}
      </p>

      <label htmlFor="tape-setting-peer-port">{pt ? 'Porta de pares' : 'Peer port'}</label>
      <input
        id="tape-setting-peer-port"
        type="number"
        min={0}
        max={65535}
        step={1}
        inputMode="numeric"
        value={drafts.peerPort}
        aria-describedby="tape-setting-peer-port-hint"
        onChange={(event) => setDrafts((current) => ({ ...current, peerPort: event.target.value }))}
        onBlur={() => commit('peerPort')}
        onKeyDown={(event) => { if (event.key === 'Enter') commit('peerPort'); }}
      />
      <p id="tape-setting-peer-port-hint" className="tape-settings-hint">
        {pt ? '0 = porta aleatória. Passa a valer no próximo início.' : '0 = random port. Applies from the next start.'}
      </p>

      <p id="tape-settings-next-start" className="tape-settings-note">
        {pt
          ? 'Proporção e porta de pares passam a valer no próximo início do compartilhamento.'
          : 'Ratio and peer port apply the next time sharing starts.'}
      </p>
    </fieldset>
  );
}
