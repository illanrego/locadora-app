import { invoke } from '@tauri-apps/api/core';
export const STREMIO_SERVICE_URL = 'http://127.0.0.1:11471/';
let bridgeInstalled = false;

// Official Video uses fetch for engine metadata. Linux's tauri:// origin is not
// HTTP, so preserve upstream CORS and bridge only our fixed owned-engine origin.
function installEngineFetchBridge() {
  if (bridgeInstalled) return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location?.href);
    if (url.origin !== new URL(STREMIO_SERVICE_URL).origin) return original(input, init);
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const reply = await invoke<{ status: number; body: string; contentType: string }>('streaming_engine_request', {
      url: request.url, method: request.method,
      body: request.method === 'POST' ? await request.text() : null,
    });
    request.signal.throwIfAborted();
    return new Response(reply.body, { status: reply.status, headers: { 'content-type': reply.contentType } });
  };
  bridgeInstalled = true;
}

export async function ensureStreamingService(): Promise<void> {
  const ready = await invoke<{ url: string }>('streaming_engine_ensure');
  if (ready.url !== STREMIO_SERVICE_URL) throw new Error('Invalid bundled streaming engine endpoint');
  installEngineFetchBridge();
}

export interface TorrentStreamSource {
  infoHash: string;
  fileIdx: number | null;
  announce: string[];
}

const INFO_HASH = /^[a-f0-9]{40}$/i;

// The engine serves a torrent's file only after that torrent is registered with
// it. Stremio Video registers one only when the stream carries tracker sources,
// so a stream without any would leave the player with a media URL the engine
// cannot serve and playback would never start. Register it ourselves, mirroring
// the same request the player library would send.
export async function ensureTorrentStream(source: TorrentStreamSource): Promise<void> {
  const infoHash = typeof source.infoHash === 'string' ? source.infoHash.toLowerCase() : '';
  if (!INFO_HASH.test(infoHash)) return;
  const announce = Array.isArray(source.announce) ? source.announce : [];
  const sources = Array.from(new Set(
    announce
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .map((entry) => (entry.startsWith('tracker:') || entry.startsWith('dht:') ? entry : `tracker:${entry}`)),
  ));
  const body: Record<string, unknown> = {
    torrent: { infoHash },
    guessFileIdx: typeof source.fileIdx === 'number' && Number.isFinite(source.fileIdx) ? false : {},
  };
  if (sources.length > 0) {
    body.peerSearch = { sources: [`dht:${infoHash}`, ...sources], min: 40, max: 200 };
  }
  await fetch(`${STREMIO_SERVICE_URL}${encodeURIComponent(infoHash)}/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
