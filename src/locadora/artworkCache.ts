import { useEffect, useState } from 'react';

export type ArtworkKind = 'poster' | 'backdrop';

const CACHE_NAMES: Record<ArtworkKind, string> = {
  poster: 'wills-locadora-posters-v1',
  backdrop: 'wills-locadora-backdrops-v1',
};
const INDEX_KEYS: Record<ArtworkKind, string> = {
  poster: 'wills-locadora-posters-index.v1',
  backdrop: 'wills-locadora-backdrops-index.v1',
};
const MAX_ENTRIES: Record<ArtworkKind, number> = {
  poster: 4_000,
  backdrop: 120,
};

interface ArtworkIndexEntry {
  url: string;
  usedAt: number;
}

interface ArtworkResolution {
  blob: Blob;
  fromCache: boolean;
}

function cacheStorage(): CacheStorage | null {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  return window.caches;
}

function readIndex(kind: ArtworkKind): ArtworkIndexEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INDEX_KEYS[kind]) ?? '[]') as ArtworkIndexEntry[];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry?.url === 'string' && typeof entry?.usedAt === 'number')
      : [];
  } catch {
    return [];
  }
}

function writeIndex(kind: ArtworkKind, entries: ArtworkIndexEntry[]): void {
  try {
    window.localStorage.setItem(INDEX_KEYS[kind], JSON.stringify(entries));
  } catch {
    // The browser cache remains useful even when its small bookkeeping index
    // cannot be written.
  }
}

function touchIndex(kind: ArtworkKind, url: string): void {
  const entries = readIndex(kind).filter((entry) => entry.url !== url);
  entries.unshift({ url, usedAt: Date.now() });
  const retained = entries.slice(0, MAX_ENTRIES[kind]);
  writeIndex(kind, retained);

  const cache = cacheStorage();
  if (!cache || entries.length <= MAX_ENTRIES[kind]) return;
  void cache.open(CACHE_NAMES[kind]).then((store) => Promise.all(
    entries.slice(MAX_ENTRIES[kind]).map((entry) => store.delete(entry.url)),
  ));
}

const pending = new Map<string, Promise<ArtworkResolution | null>>();

async function resolveArtwork(url: string, kind: ArtworkKind): Promise<ArtworkResolution | null> {
  const cachesApi = cacheStorage();
  if (!cachesApi) return null;

  const key = `${kind}:${url}`;
  const existing = pending.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const store = await cachesApi.open(CACHE_NAMES[kind]);
      let response = await store.match(url);
      const fromCache = Boolean(response);
      if (!response) {
        response = await fetch(url, { cache: 'force-cache', headers: { accept: 'image/avif,image/webp,image/*' } });
        if (!response.ok) return null;
        await store.put(url, response.clone());
      }
      touchIndex(kind, url);
      return { blob: await response.blob(), fromCache };
    } catch {
      return null;
    }
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

export function useCachedArtwork(url: string | null, kind: ArtworkKind): string | null {
  // The known remote URL must be rendered immediately. Cache Storage is a
  // persistence layer, not a render gate; waiting here made posters lose to
  // the backdrop during inspection and made shelves look empty while caching.
  const [source, setSource] = useState<string | null>(url);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSource(url);
    if (!url) return () => undefined;

    void resolveArtwork(url, kind).then((resolved) => {
      if (!resolved?.fromCache) return;
      const resolvedSource = URL.createObjectURL(resolved.blob);
      objectUrl = resolvedSource;
      if (cancelled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      setSource(resolvedSource);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, url]);

  return source;
}
