import { fetchNativeAddonJson, isNativeShell } from '../platform/nativeBridge';
import {
  connectAddon,
  normalizeAddonManifest,
  requestStreams,
  supportsResource,
  validateManifestUrl,
} from './addonProtocol';
import type { AddonConnection, StreamRequest } from './types';

export async function connectAddonForPlatform(
  manifestUrl: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AddonConnection> {
  if (!isNativeShell()) return connectAddon(manifestUrl, options);
  const validatedUrl = validateManifestUrl(manifestUrl);
  const body = await fetchNativeAddonJson({ manifestUrl: validatedUrl.href, resource: 'manifest' });
  return { manifest: normalizeAddonManifest(body), manifestUrl: validatedUrl.href };
}

export async function requestStreamsForPlatform(
  connection: AddonConnection,
  request: StreamRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown[]> {
  if (!isNativeShell()) return requestStreams(connection, request, options);
  if (!supportsResource(connection.manifest, 'stream', request.type, request.videoId)) return [];
  const body = await fetchNativeAddonJson({
    manifestUrl: connection.manifestUrl,
    resource: 'stream',
    contentType: request.type,
    id: request.videoId,
  });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { streams?: unknown }).streams)) {
    throw new Error('Add-on returned an invalid stream response');
  }
  return (body as { streams: unknown[] }).streams;
}
