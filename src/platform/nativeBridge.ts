import { invoke } from '@tauri-apps/api/core';
import type { ContentType } from '../domain/content';

export interface NativeCapabilities {
  mpv: { available: boolean; version: string | null };
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && Boolean((window as TauriWindow).__TAURI_INTERNALS__);
}

export async function readNativeCapabilities(): Promise<NativeCapabilities> {
  if (!isNativeShell()) return { mpv: { available: false, version: null } };
  return invoke<NativeCapabilities>('native_capabilities');
}

export async function fetchNativeAddonJson(request: {
  manifestUrl: string;
  resource: 'manifest' | 'stream' | 'subtitles' | 'meta';
  contentType?: ContentType;
  id?: string;
}): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native add-on transport is unavailable');
  return invoke('fetch_addon_json', { request });
}

export async function fetchNativePublicShelf(request: {
  genres: string[];
  year: number;
  contentType: ContentType;
  stand: number;
}): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native catalogue transport is unavailable');
  return invoke('fetch_public_shelf', { request });
}
