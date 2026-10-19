/**
 * P6: the read-only tape dashboard (§11.1), rendered inside the Carteirinha
 * between the active rentals and the collapsed history.
 *
 * It explains state and never changes it: no return, delete, retry, pause or
 * reprioritise control exists here. The only interactive element is "inspect
 * this title", and only when the tape's canonical content id matches a title the
 * panel already knows — otherwise the row is plain text, because inventing a
 * title to make a button would be worse than no button.
 *
 * Rows come from the local manifest and nothing else. The uploaded figure is
 * best-effort: one allowlisted read of the engine's `/<hash>/<fileIdx>/stats.json`
 * per tape, with any refusal, non-200 answer or malformed body becoming a dash.
 * The engine is never started from here (`requestTapeEngine` is not `ensure`).
 */
import { useEffect, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import type { Locale } from '../locadora/catalog';
import { requestTapeEngine, readTapeManifest, TAPE_ENGINE_ORIGIN } from '../platform/tape';
import { tapeCeilingBytes } from '../rentals/tapeAdmission';
import {
  TAPE_DISCLOSURE,
  buildTapeDashboard,
  formatTapeBytes,
  formatTapeDate,
  formatTapeTotal,
  readTapeUploaded,
  tapeStateLabel,
  type TapeDashboardEntry,
} from '../rentals/tapeDashboard';
import { readTapeSettings } from '../rentals/tapeSettings';

interface TapeDashboardProps {
  locale: Locale;
  onInspect: (title: DiscoveryTitle) => void;
  knownTitles?: readonly DiscoveryTitle[];
}

const EMPTY_TITLES: readonly DiscoveryTitle[] = [];

/**
 * One best-effort stats read per tape. Failures are per-tape and silent: an
 * engine that is off is the normal case, not an error the user must see.
 */
async function readUploadedFigures(
  tapes: readonly { infoHash: string; fileIdx: number }[],
): Promise<Map<string, number | null>> {
  const figures = await Promise.all(tapes.map(async (tape) => {
    try {
      const response = await requestTapeEngine(
        `${TAPE_ENGINE_ORIGIN}/${tape.infoHash}/${tape.fileIdx}/stats.json`,
        'GET',
      );
      if (response.status !== 200) return [tape.infoHash, null] as const;
      return [tape.infoHash, readTapeUploaded(response.body)] as const;
    } catch {
      return [tape.infoHash, null] as const;
    }
  }));
  return new Map(figures);
}

export function TapeDashboard({ locale, onInspect, knownTitles = EMPTY_TITLES }: TapeDashboardProps) {
  const pt = locale === 'pt-BR';
  const [entries, setEntries] = useState<TapeDashboardEntry[] | null>(null);
  const [ceilingBytes, setCeilingBytes] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setEntries(null);
    void readTapeManifest()
      .then(async (manifest) => {
        if (!active) return;
        // A manifest read that the platform refuses reads as "nothing to show";
        // the dashboard is an explanation, never a startup error.
        const rows = buildTapeDashboard(manifest);
        if (!rows.length) {
          setCeilingBytes(null);
          setEntries([]);
          return;
        }
        const uploaded = await readUploadedFigures(manifest.tapes);
        if (!active) return;
        setCeilingBytes(tapeCeilingBytes({ maxGb: readTapeSettings().maxGb }));
        setEntries(buildTapeDashboard(manifest, uploaded));
      })
      .catch(() => {
        if (active) setEntries([]);
      });
    return () => { active = false; };
  }, []);

  // Empty, loading and unreadable all render nothing at all: the section is an
  // explanation of retained tapes, not a fixture of the Carteirinha.
  if (!entries || entries.length === 0) return null;

  const titlesByKey = new Map<string, DiscoveryTitle>(
    knownTitles.map((title) => [title.identity.canonicalKey, title] as const),
  );

  return (
    <section className="member-section tape-dashboard" aria-labelledby="tape-dashboard-heading">
      <h3 id="tape-dashboard-heading">{pt ? 'Fitas neste aparelho' : 'Tapes on this device'}</h3>
      <table className="tape-dashboard-table">
        <caption className="sr-only">
          {pt ? 'Fitas alugadas guardadas neste aparelho' : 'Rented tapes kept on this device'}
        </caption>
        <thead>
          <tr>
            <th scope="col">{pt ? 'Título' : 'Title'}</th>
            <th scope="col">{pt ? 'Estado' : 'State'}</th>
            <th scope="col">{pt ? 'Tamanho' : 'Size'}</th>
            <th scope="col">{pt ? 'Enviado' : 'Uploaded'}</th>
            <th scope="col">{pt ? 'Último play' : 'Last played'}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const title = titlesByKey.get(entry.contentId);
            return (
              <tr key={entry.infoHash}>
                <th scope="row">
                  {title
                    ? <button type="button" className="member-title-link"
                        aria-label={pt ? `Inspecionar ${entry.title}` : `Inspect ${entry.title}`}
                        onClick={() => onInspect(title)}>{entry.title}</button>
                    : entry.title}
                </th>
                <td>{tapeStateLabel(entry.state, locale)}</td>
                <td>{formatTapeBytes(entry.sizeBytes, locale)}</td>
                <td>
                  {entry.uploadedBytes === null
                    ? <span aria-label={pt ? 'envio desconhecido' : 'upload unknown'}>—</span>
                    : formatTapeBytes(entry.uploadedBytes, locale)}
                </td>
                <td>{formatTapeDate(entry.lastPlayedAt, locale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="tape-dashboard-total">{formatTapeTotal(entries, ceilingBytes, locale)}</p>
      <p className="tape-dashboard-disclosure">{TAPE_DISCLOSURE[locale]}</p>
    </section>
  );
}
