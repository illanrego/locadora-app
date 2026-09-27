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
