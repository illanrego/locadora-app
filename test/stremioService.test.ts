import { afterEach, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); invoke.mockReset(); });

it('bridges only the owned engine and leaves other fetch requests untouched', async () => {
  const original = vi.fn().mockResolvedValue(new Response('remote'));
  vi.stubGlobal('fetch', original);
  invoke.mockResolvedValueOnce({ url: 'http://127.0.0.1:11471/' });
  const { ensureStreamingService } = await import('../src/platform/stremioService');
  await ensureStreamingService();
  invoke.mockResolvedValueOnce({ status: 200, body: '{"guessedFileIdx":0}', contentType: 'application/json' });
  const url = `http://127.0.0.1:11471/${'a'.repeat(40)}/create`;
  const response = await fetch(url, { method: 'POST', body: '{}' });
  expect(await response.json()).toEqual({ guessedFileIdx: 0 });
  expect(invoke).toHaveBeenLastCalledWith('streaming_engine_request', { url, method: 'POST', body: '{}' });
  expect(original).not.toHaveBeenCalled();
  await fetch('https://public.example.invalid/metadata');
  expect(original).toHaveBeenCalledWith('https://public.example.invalid/metadata', undefined);
  const abort = new AbortController(); abort.abort();
  await expect(fetch(url, { signal: abort.signal })).rejects.toThrow();
});

it('rejects an unexpected endpoint before installing the bridge', async () => {
  const original = vi.fn(); vi.stubGlobal('fetch', original);
  invoke.mockResolvedValue({ url: 'http://127.0.0.1:11470/' });
  const { ensureStreamingService } = await import('../src/platform/stremioService');
  await expect(ensureStreamingService()).rejects.toThrow('Invalid');
  expect(globalThis.fetch).toBe(original);
});
