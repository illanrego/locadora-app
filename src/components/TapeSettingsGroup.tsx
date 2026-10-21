/** Local-only rented-tape controls shared by Settings and the Carteirinha. */
import { useState } from 'react';
import type { Locale } from '../locadora/catalog';
import { readTapeSettings, writeTapeSettings, type TapeSettings } from '../rentals/tapeSettings';

interface TapeSettingsGroupProps {
  locale: Locale;
}

function persistTapeSettings(patch: Partial<TapeSettings>): TapeSettings {
  // Re-read before every write so controls mounted in different surfaces never
  // overwrite each other with a stale snapshot.
  return writeTapeSettings({ ...readTapeSettings(), ...patch });
}

export function TapeSettingsGroup({ locale }: TapeSettingsGroupProps) {
  const pt = locale === 'pt-BR';
  const [settings, setSettings] = useState<TapeSettings>(() => readTapeSettings());

  return (
    <fieldset className="tape-settings-group">
      <legend>{pt ? 'Fitas alugadas' : 'Rented tapes'}</legend>

      <label className="tape-settings-toggle" htmlFor="tape-setting-enabled">
        <input
          id="tape-setting-enabled"
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => setSettings(persistTapeSettings({ enabled: event.target.checked }))}
        />
        <span>{pt ? 'Baixar e guardar fitas alugadas' : 'Download and keep rented tapes'}</span>
      </label>
      <p className="tape-settings-hint">
        {settings.enabled
          ? (pt ? 'Baixa e compartilha enquanto a Locadora está aberta.' : 'Downloads and shares while Locadora is open.')
          : (pt ? 'Desligado: nada é baixado nem compartilhado.' : 'Off: nothing is downloaded or shared.')}
      </p>
      {/* Ratio and peer-port controls are intentionally hidden pending an
          owner-approved placement; their tapeSettings keys remain unchanged. */}
    </fieldset>
  );
}

export function TapeSpaceCeiling({ locale }: TapeSettingsGroupProps) {
  const pt = locale === 'pt-BR';
  const initial = readTapeSettings();
  const [acceptedMaxGb, setAcceptedMaxGb] = useState(initial.maxGb);
  const [draft, setDraft] = useState(String(initial.maxGb));

  function commit() {
    const raw = draft.trim();
    const parsed = raw === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(acceptedMaxGb));
      return;
    }
    const accepted = persistTapeSettings({ maxGb: parsed });
    setAcceptedMaxGb(accepted.maxGb);
    setDraft(String(accepted.maxGb));
  }

  return (
    <div className="tape-space-setting">
      <label htmlFor="tape-setting-max-gb">{pt ? 'Espaço para fitas (GB)' : 'Space for tapes (GB)'}</label>
      <input
        id="tape-setting-max-gb"
        type="number"
        min={0}
        step={0.5}
        inputMode="decimal"
        value={draft}
        aria-describedby="tape-setting-max-gb-hint"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      />
      <p id="tape-setting-max-gb-hint" className="tape-settings-hint">
        {pt ? '0 = sem limite de espaço.' : '0 = no storage limit.'}
      </p>
    </div>
  );
}
