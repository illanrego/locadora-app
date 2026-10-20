/**
 * P6: the read-only tape dashboard's pure half (§11.1).
 *
 * Everything the Carteirinha shows about retained tapes is computed here so the
 * component stays a renderer: the manifest row list, the readable state words,
 * the byte formatting, the total-against-ceiling sentence and the best-effort
 * `uploaded` reading from the engine's `/<hash>/<fileIdx>/stats.json`.
 *
 * Rules this module keeps:
 *
 * - The manifest is the only source of rows. A tape the manifest does not have
 *   is never shown, and a manifest row is never hidden for being in an
 *   inconvenient state.
 * - A missing uploaded figure is `null`, which the component paints as a dash.
 *   It is never `0`: zero is a measurement ("nothing uploaded yet") and a dash
 *   is the absence of one.
 * - Nothing here mutates, deletes, retries or reprioritises a tape. There is no
 *   return path: return is a domain action and lives where rentals live.
 * - No infohash, magnet, source URL or file name is ever formatted for display.
 */
import { byteUnits } from '../media/normalization';
import { TAPE_GIBIBYTE, totalBytes, type TapeManifest, type TapeState } from './tapeManifest';

const { MEBIBYTE } = byteUnits;

/** One dashboard row. `infoHash` is a React key only; it is never rendered. */
export interface TapeDashboardEntry {
  infoHash: string;
  contentId: string;
  title: string;
  /** The presented state: `ready` may read as `seeding` (see `tapePresentedState`). */
  state: TapeState;
  sizeBytes: number;
  uploadedBytes: number | null;
  lastPlayedAt: string | null;
}

/**
 * One best-effort engine reading per tape, from `/<hash>/<fileIdx>/stats.json`.
 * Either field is `null` when the reply did not carry a usable figure.
 */
export interface TapeEngineReading {
  uploadedBytes: number | null;
  isSeeder: boolean | null;
}

/**
 * Readable state words (§11.1). `resolving` reads as "verificando/checking"
 * because that is what the user sees happening, and `unverified` is spelled out
 * rather than shortened so it never looks like a fault-free `ready`.
 */
const STATE_LABELS: Record<TapeState, { 'pt-BR': string; 'en-US': string }> = {
  queued: { 'pt-BR': 'na fila', 'en-US': 'queued' },
  resolving: { 'pt-BR': 'verificando', 'en-US': 'checking' },
  downloading: { 'pt-BR': 'baixando', 'en-US': 'downloading' },
  ready: { 'pt-BR': 'pronta', 'en-US': 'ready' },
  seeding: { 'pt-BR': 'compartilhando', 'en-US': 'sharing' },
  failed: { 'pt-BR': 'falhou', 'en-US': 'failed' },
  returned: { 'pt-BR': 'devolvida', 'en-US': 'returned' },
  unverified: { 'pt-BR': 'não verificada', 'en-US': 'unverified' },
};

export function tapeStateLabel(state: TapeState, locale: string): string {
  return STATE_LABELS[state][locale === 'pt-BR' ? 'pt-BR' : 'en-US'];
}

/**
 * Builds one entry per manifest row, in manifest order. The readings map is
 * keyed by infohash and may be missing rows entirely (engine off, failed
 * request, malformed reply) — those become `null`.
 */
export function buildTapeDashboard(
  manifest: TapeManifest,
  readings: ReadonlyMap<string, TapeEngineReading | null> = new Map(),
): TapeDashboardEntry[] {
  return manifest.tapes.map((tape) => {
    const reading = readings.get(tape.infoHash) ?? null;
    return {
      infoHash: tape.infoHash,
      contentId: tape.contentId,
      title: tape.title,
      state: tapePresentedState(tape.state, reading),
      sizeBytes: tape.sizeBytes,
      uploadedBytes: reading?.uploadedBytes ?? null,
      lastPlayedAt: tape.lastPlayedAt,
    };
  });
}

/**
 * P8: the seeding state is *derived*, never written.
 *
 * A retained tape in `ready` holds a complete file, so whether it is sharing is
 * a fact about the engine, not about the manifest: the row reads as `seeding`
 * ("compartilhando") when the tape reports `isSeeder`, or when it has uploaded
 * something. A `ready` row with no uploads stays `ready` ("pronta"). Mutation is
 * never involved — no poll loop, no timer, no manifest write — and the manifest's
 * own `seeding` value stays reserved for a future engine that emits a seeding
 * event. Every other state is presented exactly as stored.
 */
export function tapePresentedState(
  state: TapeState,
  reading: TapeEngineReading | null | undefined,
): TapeState {
  if (state !== 'ready') return state;
  if (reading?.isSeeder === true) return 'seeding';
  return (reading?.uploadedBytes ?? 0) > 0 ? 'seeding' : 'ready';
}

/**
 * Best-effort engine reading from a stats reply. Any malformed, negative,
 * non-finite or absent value is `null`; a bounded body keeps a hostile reply
 * from being parsed at all. `isSeeder` is only accepted as a top-level boolean:
 * the pinned engine reports it per peer (`wires[].isSeeder`, which is about the
 * remote peer), so a peer's flag must never be read as this tape seeding.
 */
export function readTapeStats(body: string | null | undefined): TapeEngineReading {
  const none: TapeEngineReading = { uploadedBytes: null, isSeeder: null };
  if (typeof body !== 'string' || body.length === 0 || body.length > 64 * 1024) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return none;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return none;
  const record = parsed as { uploaded?: unknown; isSeeder?: unknown };
  const uploaded = record.uploaded;
  return {
    uploadedBytes: typeof uploaded === 'number' && Number.isFinite(uploaded) && uploaded >= 0
      ? Math.floor(uploaded)
      : null,
    isSeeder: typeof record.isSeeder === 'boolean' ? record.isSeeder : null,
  };
}

/** The `uploaded` figure alone, kept for callers that only need the number. */
export function readTapeUploaded(body: string | null | undefined): number | null {
  return readTapeStats(body).uploadedBytes;
}

/** "850 MB" or "4,2 GB" in the active locale. */
export function formatTapeBytes(bytes: number, locale: string): string {
  const gibibytes = bytes / TAPE_GIBIBYTE;
  return gibibytes >= 1
    ? `${gibibytes.toLocaleString(locale, { maximumFractionDigits: 1 })} GB`
    : `${Math.round(bytes / MEBIBYTE)} MB`;
}

/**
 * The summary line: total on disk against the ceiling. A `null` ceiling is the
 * documented `maxGb = 0` (no ceiling) and is said in words, not as "de —".
 */
export function formatTapeTotal(
  tapes: readonly { sizeBytes: number }[],
  ceilingBytes: number | null,
  locale: string,
): string {
  const total = formatTapeBytes(totalBytes(tapes), locale);
  if (ceilingBytes === null) {
    return locale === 'pt-BR' ? `${total} · sem limite de espaço` : `${total} · no storage limit`;
  }
  return locale === 'pt-BR'
    ? `${total} de ${formatTapeBytes(ceilingBytes, locale)}`
    : `${total} of ${formatTapeBytes(ceilingBytes, locale)}`;
}

/** Medium date, or an em dash when the manifest has no usable timestamp. */
export function formatTapeDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

/**
 * The disclosure sentence that makes the deal visible in the product (§11.1).
 * One sentence, both locales, no policy link and no configuration advice.
 */
export const TAPE_DISCLOSURE = {
  'pt-BR': 'Suas fitas alugadas são baixadas aqui e compartilhadas de volta enquanto a Locadora estiver aberta.',
  'en-US': 'Your rented tapes download here and are shared back while Locadora is open.',
} as const;
