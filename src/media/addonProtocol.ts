import type { AddonConnection, AddonManifest, AddonManifestResource, StreamRequest } from './types';

const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

function isPrivateIpv4(host: string): boolean {
  return /^(?:127|10|0)\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
}

export function validateManifestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid add-on manifest URL');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error('Add-on manifests must use HTTPS');
  if (url.username || url.password) throw new Error('Manifest URLs cannot use URL credentials');
  if (!url.pathname.endsWith('/manifest.json')) throw new Error('URL must point to manifest.json');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || isPrivateIpv4(host)) {
    throw new Error('Private-network manifests are not supported');
  }
  url.hash = '';
  return url;
}

export function buildResourceUrl(manifestUrl: string, resource: string, type: string, id: string): string {
  const url = validateManifestUrl(manifestUrl);
  const root = url.pathname.slice(0, -'/manifest.json'.length);
  url.pathname = `${root}/${encodeURIComponent(resource)}/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  url.search = '';
  return url.href;
}

function resourceDefinition(manifest: AddonManifest, resourceName: string): AddonManifestResource | null {
  for (const resource of manifest.resources) {
    if (resource === resourceName) {
      return { name: resourceName, types: manifest.types };
    }
    if (typeof resource === 'object' && resource.name === resourceName) return resource;
  }
  return null;
}

export function supportsResource(
  manifest: AddonManifest,
  resourceName: string,
  type: string,
  id: string,
): boolean {
  const resource = resourceDefinition(manifest, resourceName);
  if (!resource) return false;
  const types = resource.types ?? manifest.types;
  if (!types.includes(type)) return false;
  const prefixes = resource.idPrefixes ?? [];
  return !prefixes.length || prefixes.some((prefix) => id.startsWith(prefix));
}

function normalizeManifest(value: unknown): AddonManifest {
  if (!value || typeof value !== 'object') throw new Error('Add-on manifest is not an object');
  const raw = value as Partial<AddonManifest>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error('Add-on manifest has no ID');
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Add-on manifest has no name');
  if (typeof raw.version !== 'string' || !raw.version.trim()) throw new Error('Add-on manifest has no version');
  if (!Array.isArray(raw.types) || !raw.types.every((type) => typeof type === 'string')) {
    throw new Error('Add-on manifest has invalid types');
  }
  if (!Array.isArray(raw.resources)) throw new Error('Add-on manifest has invalid resources');
  const resources = raw.resources.filter((resource): resource is string | AddonManifestResource => {
    if (typeof resource === 'string') return true;
    return Boolean(resource) && typeof resource === 'object' && typeof resource.name === 'string';
  });
  return { id: raw.id, name: raw.name, version: raw.version, types: raw.types, resources };
}

async function boundedJson(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(new Error('Add-on request timed out')), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Add-on request failed (${response.status})`);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_JSON_BYTES) throw new Error('Add-on response is too large');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_JSON_BYTES) throw new Error('Add-on response is too large');
    try {
      return JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      throw new Error('Add-on returned invalid JSON');
    }
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function connectAddon(
  manifestUrl: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AddonConnection> {
  const url = validateManifestUrl(manifestUrl);
  const body = await boundedJson(url.href, options.fetchImpl ?? fetch, options.signal, options.timeoutMs);
  return { manifest: normalizeManifest(body), manifestUrl: url.href };
}

export async function requestStreams(
  connection: AddonConnection,
  request: StreamRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown[]> {
  if (!supportsResource(connection.manifest, 'stream', request.type, request.videoId)) return [];
  const url = buildResourceUrl(connection.manifestUrl, 'stream', request.type, request.videoId);
  const body = await boundedJson(url, options.fetchImpl ?? fetch, options.signal, options.timeoutMs);
  if (!body || typeof body !== 'object' || !Array.isArray((body as { streams?: unknown }).streams)) {
    throw new Error('Add-on returned an invalid stream response');
  }
  return (body as { streams: unknown[] }).streams;
}
