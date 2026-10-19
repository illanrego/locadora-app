import { isSeriesImdbId } from './seriesEpisodes';

const PREFIX = 'locadora:resume:v1:';
const MAX_ENTRIES = 300;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const FINISHED_REMAINING_SECONDS = 30;
const FINISHED_RATIO = 0.95;
const VIDEO_IDENTITY = /^(?:file|url):[0-9a-f]{8}$/;

export interface ResumeEpisodeContext {
  seriesId: string;
  season: number;
  episode: number;
}

export interface ResumePositionRecord {
  positionSeconds: number;
  durationSeconds: number;
  writtenAt: number;
  seriesId?: string;
  season?: number;
  episode?: number;
}

function storageKey(videoIdentity: string): string {
  return `${PREFIX}${videoIdentity}`;
}

function episodeIndex(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function finiteSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && value <= Number.MAX_SAFE_INTEGER;
}

function normalizedRecord(value: unknown): ResumePositionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ResumePositionRecord>;
  if (!finiteSeconds(candidate.positionSeconds) || !finiteSeconds(candidate.durationSeconds)
    || candidate.durationSeconds <= 0 || candidate.positionSeconds >= candidate.durationSeconds
    || typeof candidate.writtenAt !== 'number' || !Number.isSafeInteger(candidate.writtenAt)
    || candidate.writtenAt < 0) return null;

  const contextValues = [candidate.seriesId, candidate.season, candidate.episode];
  const hasContext = contextValues.some((entry) => entry !== undefined);
  if (hasContext && (!isSeriesImdbId(candidate.seriesId)
    || !episodeIndex(candidate.season, 0) || !episodeIndex(candidate.episode, 1))) return null;

  return {
    positionSeconds: candidate.positionSeconds,
    durationSeconds: candidate.durationSeconds,
    writtenAt: candidate.writtenAt,
    ...(hasContext ? {
      seriesId: candidate.seriesId,
      season: candidate.season,
      episode: candidate.episode,
    } : {}),
  };
}

function isFinished(record: Pick<ResumePositionRecord, 'positionSeconds' | 'durationSeconds'>): boolean {
  return record.positionSeconds / record.durationSeconds >= FINISHED_RATIO
    || record.durationSeconds - record.positionSeconds <= FINISHED_REMAINING_SECONDS;
}

function prefixedKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Playback remains usable when local persistence is unavailable.
  }
}

function readKey(key: string): ResumePositionRecord | null {
  try {
    const identity = key.slice(PREFIX.length);
    if (!VIDEO_IDENTITY.test(identity)) return null;
    return normalizedRecord(JSON.parse(window.localStorage.getItem(key) ?? 'null'));
  } catch {
    return null;
  }
}

function prune(now: number): void {
  try {
    const retained = prefixedKeys().flatMap((key) => {
      const record = readKey(key);
      if (!record || now - record.writtenAt > RETENTION_MS || isFinished(record)) {
        remove(key);
        return [];
      }
      return [{ key, writtenAt: record.writtenAt }];
    });
    retained.sort((left, right) => left.writtenAt - right.writtenAt || left.key.localeCompare(right.key));
    for (const entry of retained.slice(0, Math.max(0, retained.length - MAX_ENTRIES))) remove(entry.key);
  } catch {
    // A failed prune must not interrupt playback.
  }
}

export function readResumePosition(videoIdentity: string, now = Date.now()): ResumePositionRecord | null {
  if (!VIDEO_IDENTITY.test(videoIdentity) || !Number.isFinite(now) || now < 0) return null;
  const key = storageKey(videoIdentity);
  const record = readKey(key);
  if (!record || now - record.writtenAt > RETENTION_MS || isFinished(record)) {
    remove(key);
    return null;
  }
  return record;
}

export function writeResumePosition(
  videoIdentity: string,
  positionSeconds: number,
  durationSeconds: number,
  context?: ResumeEpisodeContext,
  now = Date.now(),
): void {
  if (!VIDEO_IDENTITY.test(videoIdentity) || !Number.isFinite(positionSeconds)
    || !Number.isFinite(durationSeconds) || positionSeconds <= 0 || durationSeconds <= 0
    || !Number.isSafeInteger(now) || now < 0) return;
  if (positionSeconds >= durationSeconds) {
    clearResumePosition(videoIdentity);
    return;
  }
  const record = normalizedRecord({
    positionSeconds: Math.round(positionSeconds * 1_000) / 1_000,
    durationSeconds: Math.round(durationSeconds * 1_000) / 1_000,
    writtenAt: now,
    ...context,
  });
  if (!record) return;
  if (isFinished(record)) {
    clearResumePosition(videoIdentity);
    return;
  }
  try {
    window.localStorage.setItem(storageKey(videoIdentity), JSON.stringify(record));
    prune(now);
  } catch {
    // Playback remains usable when local persistence is unavailable.
  }
}

export function clearResumePosition(videoIdentity: string): void {
  if (VIDEO_IDENTITY.test(videoIdentity)) remove(storageKey(videoIdentity));
}

function clearMatching(predicate: (record: ResumePositionRecord) => boolean): void {
  try {
    for (const key of prefixedKeys()) {
      const record = readKey(key);
      if (!record || predicate(record)) remove(key);
    }
  } catch {
    // Clearing is best effort when local persistence is unavailable.
  }
}

export function clearEpisodeResumePositions(seriesId: string, season: number, episode: number): void {
  if (!isSeriesImdbId(seriesId) || !episodeIndex(season, 0) || !episodeIndex(episode, 1)) return;
  clearMatching((record) => record.seriesId === seriesId
    && record.season === season && record.episode === episode);
}

export function clearSeriesResumePositions(seriesId: string): void {
  if (!isSeriesImdbId(seriesId)) return;
  clearMatching((record) => record.seriesId === seriesId);
}

export function clearAllSeriesResumePositions(): void {
  clearMatching((record) => record.seriesId !== undefined);
}

export function clearAllResumePositions(): void {
  try {
    for (const key of prefixedKeys()) remove(key);
  } catch {
    // Clearing is best effort when local persistence is unavailable.
  }
}
