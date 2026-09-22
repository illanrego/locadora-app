import { useEffect, useState } from 'react';
import { copy, type Locale } from '../locadora/catalog';
import {
  addMediaConfiguration,
  disconnectMediaConfiguration,
  importInstalledStremioConfiguration,
  isNativeShell,
  readMediaConfiguration,
  removeMediaConfiguration,
  type ConfiguredAddon,
} from '../platform/nativeBridge';
import { Modal } from './Modal';

interface MediaSettingsProps {
  locale: Locale;
  onClose: () => void;
}

export function MediaSettings({ locale, onClose }: MediaSettingsProps) {
  const t = copy[locale];
  const native = isNativeShell();
  const [addons, setAddons] = useState<ConfiguredAddon[]>([]);
  const [manifestUrl, setManifestUrl] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!native) return;
    setBusy(true);
    void readMediaConfiguration()
      .then(setAddons)
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  }, [native]);

  const add = async () => {
    const value = manifestUrl.trim();
    if (!value || busy) return;
    setBusy(true);
    setStatus(locale === 'pt-BR' ? 'Validando a fonte…' : 'Validating source…');
    try {
      setAddons(await addMediaConfiguration(value));
      setManifestUrl('');
      setStatus(locale === 'pt-BR' ? 'Fonte protegida no cofre do sistema.' : 'Source protected in the system vault.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const importStremio = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(locale === 'pt-BR' ? 'Lendo os add-ons do Stremio instalado…' : 'Reading installed Stremio add-ons…');
    try {
      const result = await importInstalledStremioConfiguration();
      setAddons(result.addons);
      const skipped = result.skipped.length
        ? (locale === 'pt-BR'
            ? ` ${result.skipped.length} ignorado(s): ${result.skipped.map((item) => item.name).join(', ')}.`
            : ` ${result.skipped.length} skipped: ${result.skipped.map((item) => item.name).join(', ')}.`)
        : '';
      setStatus(locale === 'pt-BR'
        ? `${result.imported} add-ons importados de ${result.source}.${skipped}`
        : `${result.imported} add-ons imported from ${result.source}.${skipped}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (addonId: string) => {
    setBusy(true);
    try {
      setAddons(await removeMediaConfiguration(addonId));
      setStatus(locale === 'pt-BR' ? 'Fonte removida deste dispositivo.' : 'Source removed from this device.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectMediaConfiguration();
      setAddons([]);
      setManifestUrl('');
      setStatus(locale === 'pt-BR' ? 'Configuração local apagada.' : 'Local configuration deleted.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal label={locale === 'pt-BR' ? 'Fontes de mídia' : 'Media sources'} onClose={onClose} className="side-modal media-settings-modal">
      <header className="panel-header">
        <p className="eyebrow">{locale === 'pt-BR' ? 'Configuração local protegida' : 'Protected local configuration'}</p>
        <h2>{locale === 'pt-BR' ? 'Fontes de mídia' : 'Media sources'}</h2>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={t.close}>×</button>
      </header>
      <p>
        {locale === 'pt-BR'
          ? 'Adicione o endereço manifest.json de uma fonte compatível. Endereços podem conter credenciais e nunca são exibidos novamente.'
          : 'Add a compatible manifest.json address. Addresses may contain credentials and are never displayed again.'}
      </p>
      {!native ? (
        <p className="panel-empty">
          {locale === 'pt-BR' ? 'Abra o aplicativo desktop para usar o cofre do sistema.' : 'Open the desktop app to use the system vault.'}
        </p>
      ) : (
        <>
          <section className="stremio-import">
            <h3>{locale === 'pt-BR' ? 'Usar seus add-ons do Stremio' : 'Use your Stremio add-ons'}</h3>
            <p>
              {locale === 'pt-BR'
                ? 'Importa a coleção do Stremio instalado sem copiar login, cookies ou histórico. A lista local atual será substituída.'
                : 'Imports the installed Stremio collection without copying login, cookies, or history. The current local list will be replaced.'}
            </p>
            <button type="button" disabled={busy} onClick={() => void importStremio()}>
              {locale === 'pt-BR' ? 'Importar do Stremio instalado' : 'Import from installed Stremio'}
            </button>
          </section>
          <form className="manifest-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
            <label htmlFor="manifest-url">Manifest URL</label>
            <input
              id="manifest-url"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={manifestUrl}
              onChange={(event) => setManifestUrl(event.target.value)}
              placeholder="https://…/manifest.json"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !manifestUrl.trim()}>{locale === 'pt-BR' ? 'Validar e guardar' : 'Validate and store'}</button>
          </form>
          <ul className="addon-list" aria-label={locale === 'pt-BR' ? 'Fontes configuradas' : 'Configured sources'}>
            {addons.map((addon) => (
              <li key={addon.id}>
                <span>
                  <strong>{addon.name}</strong>
                  <small>{addon.id} · {addon.resources.join(' + ')}</small>
                </span>
                <button type="button" disabled={busy} onClick={() => void remove(addon.id)}>{locale === 'pt-BR' ? 'Remover' : 'Remove'}</button>
              </li>
            ))}
          </ul>
          {!addons.length && !busy && <p className="panel-empty">{locale === 'pt-BR' ? 'Nenhuma fonte configurada.' : 'No sources configured.'}</p>}
          <section className="danger-zone">
            <h3>{locale === 'pt-BR' ? 'Desconectar mídia' : 'Disconnect media'}</h3>
            <p>{locale === 'pt-BR' ? 'Apaga todas as fontes deste dispositivo. Sua conta e seus aluguéis da Locadora não são alterados.' : 'Deletes all sources from this device. Your Locadora account and rentals are unchanged.'}</p>
            <button type="button" disabled={busy || !addons.length} onClick={() => void disconnect()}>{locale === 'pt-BR' ? 'Apagar configuração local' : 'Delete local configuration'}</button>
          </section>
        </>
      )}
      <p className="configuration-status" role="status" aria-live="polite">{status}</p>
    </Modal>
  );
}
