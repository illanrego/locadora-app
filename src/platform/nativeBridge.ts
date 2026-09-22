import { invoke } from '@tauri-apps/api/core';
import type { ContentType } from '../domain/content';

export interface NativeCapabilities {
  mpv: { available: boolean; version: string | null };
}

export type NativePlayerEvent =
  | { kind: 'ready' }
  | { kind: 'file-loaded' }
  | { kind: 'playing' }
  | { kind: 'paused' }
  | { kind: 'position'; value: number }
  | { kind: 'duration'; value: number }
  | { kind: 'ended'; value: string }
  | { kind: 'idle' }
  | { kind: 'failed'; value: string };

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

export async function startNativePlayer(): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_start');
}

export async function loadNativePlayer(descriptor: string): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_load', { descriptor });
}

export async function controlNativePlayer(action: 'pause' | 'resume' | 'seek' | 'stop', seconds?: number): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_control', { action, seconds });
}

export async function readNativePlayerEvents(): Promise<NativePlayerEvent[]> {
  if (!isNativeShell()) return [];
  return invoke<NativePlayerEvent[]>('player_events');
}

export async function shutdownNativePlayer(): Promise<void> {
  if (!isNativeShell()) return;
  return invoke('player_shutdown');
}
