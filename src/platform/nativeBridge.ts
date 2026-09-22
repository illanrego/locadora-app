import { invoke } from '@tauri-apps/api/core';
import type { ContentType } from '../domain/content';

export interface NativeCapabilities {
  mpv: { available: boolean; version: string | null };
}

export interface ConfiguredAddon {
  id: string;
  name: string;
  supportsStreams: boolean;
  supportsSubtitles: boolean;
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

export async function setNativePlayerProperty(name: string, value: unknown): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_set_property', { request: { name, value } });
}

export async function readNativePlayerEvents(): Promise<NativePlayerEvent[]> {
  if (!isNativeShell()) return [];
  return invoke<NativePlayerEvent[]>('player_events');
}

export async function shutdownNativePlayer(): Promise<void> {
  if (!isNativeShell()) return;
  return invoke('player_shutdown');
}

export async function readMediaConfiguration(): Promise<ConfiguredAddon[]> {
  if (!isNativeShell()) return [];
  return invoke<ConfiguredAddon[]>('media_configuration_status');
}

export async function addMediaConfiguration(manifestUrl: string): Promise<ConfiguredAddon[]> {
  if (!isNativeShell()) throw new Error('Protected media configuration is available in the desktop app');
  return invoke<ConfiguredAddon[]>('media_configuration_add', { manifestUrl });
}

export async function removeMediaConfiguration(addonId: string): Promise<ConfiguredAddon[]> {
  if (!isNativeShell()) throw new Error('Protected media configuration is available in the desktop app');
  return invoke<ConfiguredAddon[]>('media_configuration_remove', { addonId });
}

export async function disconnectMediaConfiguration(): Promise<void> {
  if (!isNativeShell()) return;
  return invoke('media_configuration_disconnect');
}

export async function fetchConfiguredAddonResource(request: {
  addonId: string;
  resource: 'stream' | 'subtitles' | 'meta';
  contentType: ContentType;
  id: string;
}): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Protected media configuration is available in the desktop app');
  return invoke('fetch_configured_addon_resource', { request });
}
