/**
 * Typed wrappers over the native tape commands (§20 frozen contract).
 *
 * Marshalling and validation only: argument names, the fixed 11472 origin, the
 * tape path grammar, the manifest shape and the progress payload. No queue
 * policy, no rental logic and no engine protocol beyond the allowlist the native
 * bridge already enforces. Every rejection surfaces as a `TapePlatformError`
 * carrying one of the driver's closed failure codes, so the queue can classify it
 * without string matching.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  MAX_MANIFEST_BYTES,
  encodedManifestBytes,
  isFileIdx,
  isInfoHash,
  normalizeManifest,
  type TapeManifest,
} from '../rentals/tapeManifest';
import {
  normalizeTapeDownloadProgress,
  readTapeFailureCode,
  type TapeDownloadProgress,
  type TapeFailureCode,
  type TapeQueueDriver,
} from '../rentals/tapeQueue';
import { isNativeShell } from './nativeBridge';

/** The tape engine's fixed loopback port; reserved fail-closed (§20). */
export const TAPE_ENGINE_PORT = 11472;
export const TAPE_ENGINE_ORIGIN = `http://127.0.0.1:${TAPE_ENGINE_PORT}`;
export const TAPE_PROGRESS_EVENT = 'tape-download-progress';

/** Native request-body ceiling for the tape bridge (§20). */
const MAX_TAPE_REQUEST_BODY_BYTES = 3 * 1024 * 1024;
const TAPE_PATH_PATTERN = /^\/[0-9a-f]{40}(?:\/\d{1,4})?(?:\/(?:stats\.json|create|remove))?$/;
const UNAVAILABLE = 'Rented tapes are available in the desktop app';

export interface TapeEngineResponse {
  status: number;
  body: string;
  contentType: string;
}

export class TapePlatformError extends Error {
  readonly code: TapeFailureCode;

  constructor(code: TapeFailureCode, message: string) {
    super(message);
    this.name = 'TapePlatformError';
    this.code = code;
  }
}

function nativeFailure(error: unknown, fallback: TapeFailureCode): TapePlatformError {
  if (error instanceof TapePlatformError) return error;
  const message = typeof error === 'object' && error !== null
    ? (error as { message?: unknown }).message
    : undefined;
  return new TapePlatformError(
    readTapeFailureCode(error) ?? fallback,
    typeof message === 'string' && message.length > 0 && message.length <= 512
      ? message
      : 'The tape download failed.',
  );
}

function requireNativeShell(): void {
  if (!isNativeShell()) throw new TapePlatformError('engine-unavailable', UNAVAILABLE);
}

/**
 * Applies the same origin and path rules the native validator applies, so a call
 * that could never be allowed fails here with a typed error instead of a string.
 */
export function isAllowedTapeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== TAPE_ENGINE_ORIGIN) return false;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  return TAPE_PATH_PATTERN.test(parsed.pathname);
}

/**
 * Starts the tape engine (lazily, on the first rented tape) and returns its fixed
 * origin. Any other answer is refused rather than followed.
 */
export async function ensureTapeEngine(peerPort?: number | null): Promise<string> {
  requireNativeShell();
  let ready: { url?: unknown } | null;
  try {
    ready = await invoke<{ url?: unknown } | null>('tape_engine_ensure', { peerPort: peerPort ?? null });
  } catch (error) {
    throw nativeFailure(error, 'engine-unavailable');
  }
  if (ready?.url !== TAPE_ENGINE_ORIGIN) {
    throw new TapePlatformError('engine-unavailable', 'The tape engine answered on an unexpected address.');
  }
  return TAPE_ENGINE_ORIGIN;
}

/**
 * One allowlisted request against the tape engine. A body is only legal on
 * `create`, and a non-2xx status is returned rather than thrown: callers decide
 * what a missing torrent or a rejected setting means.
 */
export async function requestTapeEngine(
  url: string,
  method: 'GET' | 'POST',
  body?: string | null,
): Promise<TapeEngineResponse> {
  requireNativeShell();
  if (!isAllowedTapeUrl(url)) {
    throw new TapePlatformError('invalid-request', 'Invalid tape engine request.');
  }
  if (method === 'GET' && body != null) {
    throw new TapePlatformError('invalid-request', 'Invalid tape engine request.');
  }
  if (method === 'POST' && !url.endsWith('/create')) {
    throw new TapePlatformError('invalid-request', 'Invalid tape engine request.');
  }
  if (body != null && new TextEncoder().encode(body).length > MAX_TAPE_REQUEST_BODY_BYTES) {
    throw new TapePlatformError('too-large', 'The tape engine request is too large.');
  }

  let response: unknown;
  try {
    response = await invoke<unknown>('tape_engine_request', { url, method, body: body ?? null });
  } catch (error) {
    throw nativeFailure(error, 'engine-unavailable');
  }
  return normalizeEngineResponse(response);
}

function normalizeEngineResponse(value: unknown): TapeEngineResponse {
  if (typeof value !== 'object' || value === null) {
    throw new TapePlatformError('engine-unavailable', 'The tape engine returned an unreadable response.');
  }
  const { status, body, contentType } = value as { status?: unknown; body?: unknown; contentType?: unknown };
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    throw new TapePlatformError('engine-unavailable', 'The tape engine returned an unreadable response.');
  }
  if (typeof body !== 'string' || typeof contentType !== 'string') {
    throw new TapePlatformError('engine-unavailable', 'The tape engine returned an unreadable response.');
  }
  return { status, body, contentType };
}

/**
 * Reads the private manifest. A missing, corrupt or oversized file already reads
 * as `null` natively (§8), so the result is the empty manifest and never a throw.
 */
export async function readTapeManifest(): Promise<TapeManifest> {
  if (!isNativeShell()) return normalizeManifest(null);
  try {
    return normalizeManifest(await invoke<unknown>('tape_store_read'));
  } catch (error) {
    throw nativeFailure(error, 'read-failed');
  }
}

/**
 * Writes the manifest. A manifest the native validator would reject is refused
 * here, and so is one this module would have to drop a row from: a lossy write is
 * a silent data loss, not a repair.
 */
export async function writeTapeManifest(manifest: TapeManifest): Promise<void> {
  requireNativeShell();
  const accepted = normalizeManifest(manifest);
  if (accepted.version !== manifest.version || accepted.tapes.length !== manifest.tapes.length) {
    throw new TapePlatformError('invalid-request', 'Refusing to write an invalid tape manifest.');
  }
  if (encodedManifestBytes(accepted) > MAX_MANIFEST_BYTES) {
    throw new TapePlatformError('too-large', 'The tape manifest exceeded the storage limit.');
  }
  try {
    await invoke('tape_store_write', { manifest: accepted });
  } catch (error) {
    throw nativeFailure(error, 'read-failed');
  }
}

export async function clearTapeManifest(): Promise<void> {
  requireNativeShell();
  try {
    await invoke('tape_store_clear');
  } catch (error) {
    throw nativeFailure(error, 'read-failed');
  }
}

/**
 * Starts the native drain. The returned promise settles only at the terminal
 * state; `tape-download-progress` events carry the progress in between.
 */
export async function startTapeDownload(infoHash: string, fileIdx: number): Promise<void> {
  requireNativeShell();
  if (!isInfoHash(infoHash) || !isFileIdx(fileIdx)) {
    throw new TapePlatformError('invalid-request', 'Invalid tape download request.');
  }
  try {
    await invoke('tape_download_start', { infoHash, fileIdx });
  } catch (error) {
    throw nativeFailure(error, 'read-failed');
  }
}

export async function cancelTapeDownload(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await invoke('tape_download_cancel');
  } catch (error) {
    throw nativeFailure(error, 'read-failed');
  }
}

/**
 * Subscribes to native download progress. Malformed payloads are dropped instead
 * of forwarded, so no external shape can reach the queue's state machine.
 */
export async function onTapeDownloadProgress(
  callback: (event: TapeDownloadProgress) => void,
): Promise<UnlistenFn> {
  if (!isNativeShell()) return () => undefined;
  return listen<unknown>(TAPE_PROGRESS_EVENT, (event) => {
    const progress = normalizeTapeDownloadProgress(event.payload);
    if (progress) callback(progress);
  });
}

/** The native implementation of the queue's injected driver. */
export function createTapeDownloadDriver(): TapeQueueDriver {
  return {
    start: (infoHash, fileIdx) => startTapeDownload(infoHash, fileIdx),
    cancel: () => cancelTapeDownload(),
  };
}
