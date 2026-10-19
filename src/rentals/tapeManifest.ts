/**
 * The app-owned rented-tape manifest (design §7, frozen contract §20).
 *
 * Every bound here mirrors `src-tauri/src/tape_store.rs` exactly, so a manifest
 * this module accepts is a manifest the native writer accepts: at most ten rows,
 * a version-1 object with no unknown fields, lower-case 40-hex infohashes, file
 * indexes 0..9999, JavaScript-safe positive sizes, bounded text without control
 * characters, and an optional bounded `.torrent` payload.
 *
 * A tape row is validated as a whole. One invalid field drops the row entirely
 * instead of trusting a repaired half of it, because the native side rejects the
 * whole document for that same field and a partially trusted row would be a row
 * the app can read but never write.
 */
import { byteUnits } from '../media/normalization';

const { GIBIBYTE } = byteUnits;

/** Native `MAX_TAPES`. */
export const MAX_TAPES = 10;
/** Native `MAX_MANIFEST_BYTES`. */
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
/** Native `MAX_TORRENT_BYTES`, the decoded `.torrent` payload ceiling. */
export const MAX_TORRENT_BYTES = 8 * 1024 * 1024;
/** Native `file_idx <= 9_999`, also the tape-engine path grammar limit. */
export const MAX_FILE_IDX = 9_999;
/** Native `size_bytes` upper bound: `u64` capped at the JavaScript-safe integer. */
export const MAX_TAPE_BYTES = Number.MAX_SAFE_INTEGER;
/** Native `descriptor.sources` ceiling. */
export const MAX_TAPE_SOURCES = 64;
/** Gibibyte used by the 6 GB default (§20). */
export const TAPE_GIBIBYTE = GIBIBYTE;

const RENTAL_ID_BYTES = 180;
const CONTENT_ID_BYTES = 180;
const TITLE_BYTES = 512;
const FILE_NAME_BYTES = 1_024;
const SOURCE_BYTES = 2_048;
const MAGNET_BYTES = 8_192;
const TIMESTAMP_BYTES = 64;

export type TapeState =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'ready'
  | 'seeding'
  | 'failed'
  | 'returned'
  | 'unverified';

export const TAPE_STATES: readonly TapeState[] = [
  'queued',
  'resolving',
  'downloading',
  'ready',
  'seeding',
  'failed',
  'returned',
  'unverified',
];

export interface TapeDescriptor {
  sources: string[];
  magnet: string;
}

export interface TapeRecord {
  rentalId: string;
  contentId: string;
  title: string;
  infoHash: string;
  fileIdx: number;
  fileName: string;
  sizeBytes: number;
  descriptor: TapeDescriptor;
  /** Only set when the add-on supplied raw `.torrent` bytes (§7). */
  torrentBytesB64: string | null;
  state: TapeState;
  addedAt: string;
  completedAt: string | null;
  lastPlayedAt: string | null;
}

export interface TapeManifest {
  version: 1;
  tapes: TapeRecord[];
}

const TAPE_MANIFEST_KEYS = new Set(['version', 'tapes']);
const TAPE_RECORD_KEYS = new Set([
  'rentalId',
  'contentId',
  'title',
  'infoHash',
  'fileIdx',
  'fileName',
  'sizeBytes',
  'descriptor',
  'torrentBytesB64',
  'state',
  'addedAt',
  'completedAt',
  'lastPlayedAt',
]);
const TAPE_DESCRIPTOR_KEYS = new Set(['sources', 'magnet']);

const INFO_HASH_PATTERN = /^[0-9a-f]{40}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
// Rust `char::is_control()` is the Cc category: C0, DEL and the C1 block.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

const textEncoder = new TextEncoder();

export function emptyTapeManifest(): TapeManifest {
  return { version: 1, tapes: [] };
}

export function isInfoHash(value: unknown): value is string {
  return typeof value === 'string' && INFO_HASH_PATTERN.test(value);
}

export function isFileIdx(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_FILE_IDX;
}

export function isTapeSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_TAPE_BYTES;
}

export function isTapeTimestamp(value: unknown): value is string {
  return boundedText(value, TIMESTAMP_BYTES);
}

export function isTapeState(value: unknown): value is TapeState {
  return typeof value === 'string' && (TAPE_STATES as readonly string[]).includes(value);
}

/** Byte length, which is what the native validator measures. */
export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && utf8ByteLength(value) <= maxBytes
    && !CONTROL_CHARACTERS.test(value);
}

/**
 * Mirrors the `STANDARD` base64 decode the native validator performs, without
 * materialising the payload: characters, padding, quantum length and the
 * decoded size all have to be legal.
 */
export function decodedTorrentBytes(encoded: string): number | null {
  if (encoded.length === 0 || encoded.length % 4 !== 0) return null;
  if (!BASE64_PATTERN.test(encoded)) return null;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function isTorrentBytesB64(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > Math.ceil(MAX_TORRENT_BYTES / 3) * 4) return false;
  const decoded = decodedTorrentBytes(value);
  return decoded !== null && decoded > 0 && decoded <= MAX_TORRENT_BYTES;
}

function normalizeDescriptor(value: unknown): TapeDescriptor | null {
  if (!isRecord(value) || !hasOnlyKeys(value, TAPE_DESCRIPTOR_KEYS)) return null;
  const sources = value.sources;
  if (!Array.isArray(sources) || sources.length > MAX_TAPE_SOURCES) return null;
  if (!sources.every((source) => boundedText(source, SOURCE_BYTES))) return null;
  const magnet = value.magnet;
  if (!boundedText(magnet, MAGNET_BYTES) || !magnet.startsWith('magnet:?')) return null;
  return { sources: [...sources], magnet };
}

/**
 * Returns a fully validated copy of one tape row, or `null` when any field is
 * out of bounds. Extra keys are refused, matching `deny_unknown_fields`.
 */
export function normalizeTape(value: unknown): TapeRecord | null {
  if (!isRecord(value) || !hasOnlyKeys(value, TAPE_RECORD_KEYS)) return null;

  const { rentalId, contentId, title, infoHash, fileIdx, fileName, sizeBytes, state, addedAt } = value;
  if (!boundedText(rentalId, RENTAL_ID_BYTES)) return null;
  if (!boundedText(contentId, CONTENT_ID_BYTES)) return null;
  if (!boundedText(title, TITLE_BYTES)) return null;
  if (!isInfoHash(infoHash)) return null;
  if (!isFileIdx(fileIdx)) return null;
  if (!boundedText(fileName, FILE_NAME_BYTES)) return null;
  if (!isTapeSize(sizeBytes)) return null;
  if (!isTapeState(state)) return null;
  if (!boundedText(addedAt, TIMESTAMP_BYTES)) return null;

  const descriptor = normalizeDescriptor(value.descriptor);
  if (!descriptor) return null;

  const torrentBytesB64 = value.torrentBytesB64 ?? null;
  if (torrentBytesB64 !== null && !isTorrentBytesB64(torrentBytesB64)) return null;

  const completedAt = value.completedAt ?? null;
  if (completedAt !== null && !isTapeTimestamp(completedAt)) return null;

  const lastPlayedAt = value.lastPlayedAt ?? null;
  if (lastPlayedAt !== null && !isTapeTimestamp(lastPlayedAt)) return null;

  return {
    rentalId,
    contentId,
    title,
    infoHash,
    fileIdx,
    fileName,
    sizeBytes,
    descriptor,
    torrentBytesB64,
    state,
    addedAt,
    completedAt,
    lastPlayedAt,
  };
}

/**
 * Reads untrusted storage into a manifest the native writer will accept.
 *
 * A corrupt document, an unknown version or an unknown top-level field reads as
 * the empty manifest (§8: a corrupt `tape-store.json` is never mass-deleted and
 * never blocks the app). Individual malformed rows are dropped, and a collection
 * larger than the native ceiling is truncated so the result stays writable.
 */
export function normalizeManifest(value: unknown): TapeManifest {
  if (!isRecord(value) || !hasOnlyKeys(value, TAPE_MANIFEST_KEYS)) return emptyTapeManifest();
  if (value.version !== 1) return emptyTapeManifest();
  if (!Array.isArray(value.tapes)) return emptyTapeManifest();

  const tapes: TapeRecord[] = [];
  for (const candidate of value.tapes) {
    const tape = normalizeTape(candidate);
    if (tape) tapes.push(tape);
    if (tapes.length === MAX_TAPES) break;
  }
  return { version: 1, tapes };
}

export function encodedManifestBytes(manifest: TapeManifest): number {
  return utf8ByteLength(JSON.stringify(manifest));
}

export function findTape(manifest: TapeManifest, infoHash: string): TapeRecord | null {
  return manifest.tapes.find((tape) => tape.infoHash === infoHash) ?? null;
}

/**
 * Declared bytes for a set of tapes, saturating at the safe-integer ceiling so a
 * hostile manifest cannot make the admission comparison lose precision.
 * Callers pass already-normalised rows; a row with an impossible size is skipped.
 */
export function totalBytes(tapes: readonly { sizeBytes: number }[]): number {
  let total = 0;
  for (const tape of tapes) {
    if (!isTapeSize(tape.sizeBytes)) continue;
    total = total + tape.sizeBytes > MAX_TAPE_BYTES ? MAX_TAPE_BYTES : total + tape.sizeBytes;
  }
  return total;
}

/**
 * Inserts or replaces one tape, keyed by infohash because the store keeps one
 * directory per infohash. Returns `null` when the row is malformed or when the
 * result would exceed the native count or byte ceilings, so nothing invalid ever
 * reaches `tape_store_write`.
 */
export function upsertTape(manifest: TapeManifest, tape: unknown): TapeManifest | null {
  const record = normalizeTape(tape);
  if (!record) return null;

  const existing = manifest.tapes.findIndex((candidate) => candidate.infoHash === record.infoHash);
  const tapes = existing === -1
    ? [...manifest.tapes, record]
    : manifest.tapes.map((candidate, index) => (index === existing ? record : candidate));
  if (tapes.length > MAX_TAPES) return null;

  const next: TapeManifest = { version: 1, tapes };
  return encodedManifestBytes(next) > MAX_MANIFEST_BYTES ? null : next;
}

export function removeTape(manifest: TapeManifest, infoHash: string): TapeManifest {
  return {
    version: 1,
    tapes: manifest.tapes.filter((tape) => tape.infoHash !== infoHash),
  };
}

export interface TapeTouch {
  state?: TapeState;
  completedAt?: string | null;
  lastPlayedAt?: string | null;
}

/**
 * Applies a lifecycle change to one row. Returns `null` when the tape is absent
 * or the change would produce an invalid row, so a caller can refuse to persist
 * rather than write a row the native validator rejects.
 */
export function touchTape(manifest: TapeManifest, infoHash: string, touch: TapeTouch): TapeManifest | null {
  const index = manifest.tapes.findIndex((tape) => tape.infoHash === infoHash);
  if (index === -1) return null;

  const current = manifest.tapes[index];
  const record = normalizeTape({
    ...current,
    state: touch.state ?? current.state,
    completedAt: touch.completedAt === undefined ? current.completedAt : touch.completedAt,
    lastPlayedAt: touch.lastPlayedAt === undefined ? current.lastPlayedAt : touch.lastPlayedAt,
  });
  if (!record) return null;

  const next: TapeManifest = {
    version: 1,
    tapes: manifest.tapes.map((tape, position) => (position === index ? record : tape)),
  };
  return encodedManifestBytes(next) > MAX_MANIFEST_BYTES ? null : next;
}
