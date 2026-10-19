import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ContentType } from '../domain/content';

export interface NativeCapabilities {
  mpv: { available: boolean; version: string | null };
}

export interface ConfiguredAddon {
  id: string;
  name: string;
  resources: Array<'stream' | 'subtitles' | 'meta' | 'catalog' | 'addon_catalog'>;
  supportsStreams: boolean;
  supportsSubtitles: boolean;
}

export interface StremioImportResult {
  addons: ConfiguredAddon[];
  imported: number;
  skipped: Array<{ name: string; reason: string }>;
  source: string;
}

export interface MemberUser {
  id: string;
  username: string | null;
}

export interface MemberSessionStatus {
  configured: boolean;
  signedIn: boolean;
  user: MemberUser | null;
}

export type NativePlayerEvent =
  | { kind: 'ready' }
  | { kind: 'file-loaded' }
  | { kind: 'playing' }
  | { kind: 'paused' }
  | { kind: 'position'; value: number }
  | { kind: 'duration'; value: number }
  | { kind: 'property'; value: { name: string; data: unknown } }
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

export async function readMemberSession(): Promise<MemberSessionStatus> {
  if (!isNativeShell()) return { configured: false, signedIn: false, user: null };
  return invoke<MemberSessionStatus>('member_session_status');
}

export async function signInMember(identifier: string, password: string): Promise<MemberSessionStatus> {
  if (!isNativeShell()) throw new Error('Locadora accounts are available in the desktop app');
  return invoke<MemberSessionStatus>('member_sign_in', { credentials: { identifier, password } });
}

export async function signUpMember(email: string, username: string, password: string): Promise<MemberSessionStatus> {
  if (!isNativeShell()) throw new Error('Locadora accounts are available in the desktop app');
  return invoke<MemberSessionStatus>('member_sign_up', { signup: { email, username, password } });
}

export async function updateMemberProfile(username: string): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora accounts are available in the desktop app');
  return invoke('member_update_profile', { update: { username } });
}

export async function updateMemberRentalLimit(rentalLimit: number): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora accounts are available in the desktop app');
  return invoke('member_update_rental_limit', { rentalLimit });
}

export async function updateMemberCollection(request: {
  collection: 'watch_later' | 'favorite';
  enabled: boolean;
  tmdbId: number;
  contentType: ContentType;
  name: string;
  year: number | null;
}): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora account sync is available in the desktop app');
  return invoke('member_update_collection', { update: request });
}

export async function createMemberRental(titles: Array<{
  tmdbId: number;
  contentType: ContentType;
  name: string;
  year: number | null;
}>): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora rentals are available in the desktop app');
  return invoke('member_create_rental', { request: { titles } });
}

export async function returnMemberRental(itemId: string, watchedStatus: 'watched' | 'not_watched' | 'unknown'): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora returns are available in the desktop app');
  return invoke('member_return_rental', { request: { itemId, watchedStatus } });
}

export async function fetchMemberHistory(offset: number): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora history is available in the desktop app');
  return invoke('member_history', { request: { offset } });
}

export async function fetchTitleReviews(contentType: ContentType, tmdbId: number): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora reviews are available in the desktop app');
  return invoke('title_reviews', { request: { contentType, tmdbId } });
}

export async function fetchMemberReviewEligibility(contentType: ContentType, tmdbId: number): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora review eligibility is available in the desktop app');
  return invoke('member_review_eligibility', { request: { contentType, tmdbId } });
}

export async function writeMemberReview(contentType: ContentType, tmdbId: number, rating: number, body: string): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora reviews are available in the desktop app');
  return invoke('member_write_review', { write: { contentType, tmdbId, rating, body } });
}

export async function signOutMember(): Promise<MemberSessionStatus> {
  if (!isNativeShell()) return { configured: false, signedIn: false, user: null };
  return invoke<MemberSessionStatus>('member_sign_out');
}

export async function fetchMemberState(): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Locadora accounts are available in the desktop app');
  return invoke('member_state');
}

export async function fetchNativePublicShelf(request: {
  genres: string[];
  year: number;
  contentType: ContentType;
  stand: number;
  sort: 'relevance' | 'year' | 'rating';
}): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native catalogue transport is unavailable');
  return invoke('fetch_public_shelf', { request });
}

export async function fetchNativePublicTitle(request: {
  contentType: ContentType;
  tmdbId: number;
  locale: 'pt-BR' | 'en-US';
}): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native catalogue transport is unavailable');
  return invoke('fetch_public_title', { request });
}

export async function fetchNativePublicSearch(request: { query: string; locale: 'pt-BR' | 'en-US' }): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native catalogue transport is unavailable');
  return invoke('fetch_public_search', { request });
}

export async function fetchNativePublicPersonSearch(request: { query: string; locale: 'pt-BR' | 'en-US' }): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native catalogue transport is unavailable');
  return invoke('fetch_public_person_search', { request });
}

export async function fetchNativePublicPerson(request: { personId: string; locale: 'pt-BR' | 'en-US' }): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native catalogue transport is unavailable');
  return invoke('fetch_public_person', { request });
}

export async function fetchNativeCreditStand(request: {
  personId: string;
  department: string;
  year: number;
  stand: number;
  sort: 'relevance' | 'year' | 'rating';
  locale: 'pt-BR' | 'en-US';
}): Promise<unknown> {
  if (!isNativeShell()) throw new Error('Native catalogue transport is unavailable');
  return invoke('fetch_public_credit_stand', { request });
}

export async function fetchNativePublicArtwork(url: string): Promise<string> {
  if (!isNativeShell()) throw new Error('Native artwork transport is unavailable');
  return invoke<string>('fetch_public_artwork', { request: { url } });
}

export async function startNativePlayer(): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_start');
}

export interface NativeVideoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  visible: boolean;
  fullscreen: boolean;
}

export async function setNativeVideoBounds(request: NativeVideoBounds): Promise<void> {
  if (!isNativeShell()) return;
  return invoke('player_set_bounds', { request });
}

export async function setNativePlayerFullscreen(fullscreen: boolean): Promise<void> {
  if (!isNativeShell()) return;
  return invoke('player_fullscreen', { fullscreen });
}

export async function onNativePlayerFullscreenChanged(
  callback: (fullscreen: boolean) => void,
): Promise<UnlistenFn> {
  if (!isNativeShell()) return () => undefined;
  return listen<boolean>('player-fullscreen-changed', (event) => callback(event.payload));
}

export async function onNativePlayerRenderError(callback: (message: string) => void): Promise<UnlistenFn> {
  if (!isNativeShell()) return () => undefined;
  return listen<string>('player-render-error', (event) => callback(event.payload));
}

export async function loadNativePlayer(descriptor: string): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_load', { descriptor });
}

export async function controlNativePlayer(action: 'pause' | 'resume' | 'seek' | 'stop', seconds?: number): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_control', { action, seconds });
}

export async function markNativePlayerHiccup(): Promise<void> {
  if (!isNativeShell()) return;
  return invoke('player_mark');
}

export async function setNativePlayerProperty(name: string, value: unknown): Promise<void> {
  if (!isNativeShell()) throw new Error('Native player is unavailable');
  return invoke('player_set_property', { request: { name, value } });
}

export async function readNativePlayerEvents(): Promise<NativePlayerEvent[]> {
  if (!isNativeShell()) return [];
  return invoke<NativePlayerEvent[]>('player_events');
}

export async function selectNativeSubtitle(url: string | null): Promise<void> {
  if (!isNativeShell()) throw new Error('Native subtitles require the desktop app');
  return invoke('player_select_subtitle', { url });
}

type MediaDefaultResource = 'meta' | 'stream' | 'subtitles';

interface DefaultMediaAddon {
  resource: MediaDefaultResource;
  manifestUrl: string;
}

/**
 * The three resources a brand-new install cannot answer on its own. Each one is
 * a bare, unconfigured public manifest: no account, no key, no debrid
 * configuration. A credential shipped in a desktop binary is a published
 * credential, so these URLs must stay exactly like this (plan §12). Appended in
 * this order, after whatever the user already configured.
 */
const DEFAULT_MEDIA_ADDONS: readonly DefaultMediaAddon[] = [
  { resource: 'meta', manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json' },
  { resource: 'stream', manifestUrl: 'https://torrentio.strem.fun/manifest.json' },
  { resource: 'subtitles', manifestUrl: 'https://opensubtitles-v3.strem.io/manifest.json' },
];

const MEDIA_DEFAULT_RESOURCES: readonly MediaDefaultResource[] = ['meta', 'stream', 'subtitles'];
const DEFAULT_MEDIA_SEED_KEY_PREFIX = 'locadora:default-media-seed-v1';
let mediaConfigurationQueue: Promise<unknown> = Promise.resolve();
const defaultSeedsRecordedThisSession = new Set<MediaDefaultResource>();

function serializeMediaConfiguration<T>(task: () => Promise<T>): Promise<T> {
  const result = mediaConfigurationQueue.then(task, task);
  mediaConfigurationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function defaultSeedKey(resource: MediaDefaultResource): string {
  return `${DEFAULT_MEDIA_SEED_KEY_PREFIX}:${resource}`;
}

// One flag per resource: seeding metadata must not mark streams or subtitles as
// decided, and a resource whose add-on add failed stays unrecorded so a later
// read may try that one again.
function defaultSeedRecorded(resource: MediaDefaultResource): boolean {
  if (defaultSeedsRecordedThisSession.has(resource)) return true;
  try {
    return window.localStorage.getItem(defaultSeedKey(resource)) === '1';
  } catch {
    return false;
  }
}

function recordDefaultSeeds(resources: readonly MediaDefaultResource[]): void {
  for (const resource of resources) {
    defaultSeedsRecordedThisSession.add(resource);
    try {
      window.localStorage.setItem(defaultSeedKey(resource), '1');
    } catch {
      // A working keyring remains useful when WebView local storage is unavailable.
    }
  }
}

/**
 * A configured add-on answers a resource when it declares it. The default is
 * only a floor for a slot nothing else fills, so a user's own Torrentio —
 * including a debrid-configured one — is never duplicated by a public one.
 */
function configurationCovers(
  addons: readonly ConfiguredAddon[],
  resource: MediaDefaultResource,
): boolean {
  return addons.some((addon) => Array.isArray(addon.resources) && addon.resources.includes(resource));
}

function declaredDefaultResources(addon: ConfiguredAddon | undefined): MediaDefaultResource[] {
  if (!addon || !Array.isArray(addon.resources)) return [];
  return MEDIA_DEFAULT_RESOURCES.filter((resource) => addon.resources.includes(resource));
}

export async function shutdownNativePlayer(): Promise<void> {
  if (!isNativeShell()) return;
  return invoke('player_shutdown');
}

export async function readMediaConfiguration(): Promise<ConfiguredAddon[]> {
  if (!isNativeShell()) return [];
  return serializeMediaConfiguration(async () => {
    let addons = await invoke<ConfiguredAddon[]>('media_configuration_status');
    // Appending keeps the user's order intact: defaults only ever land at the
    // end, in the fixed metadata → stream → subtitles order.
    for (const { resource, manifestUrl } of DEFAULT_MEDIA_ADDONS) {
      if (defaultSeedRecorded(resource)) continue;
      if (configurationCovers(addons, resource)) {
        // A slot the user already fills is a settled decision: record it so no
        // later read appends a bundled default behind their back.
        recordDefaultSeeds([resource]);
        continue;
      }
      try {
        addons = await invoke<ConfiguredAddon[]>('media_configuration_add', { manifestUrl });
        recordDefaultSeeds([resource]);
      } catch {
        // The public default is optional when its manifest cannot be reached.
        // Nothing is recorded for it, so one later read may try again; this
        // read never retries it.
      }
    }
    return addons;
  });
}

export async function addMediaConfiguration(manifestUrl: string): Promise<ConfiguredAddon[]> {
  if (!isNativeShell()) throw new Error('Protected media configuration is available in the desktop app');
  return serializeMediaConfiguration(async () => {
    const addons = await invoke<ConfiguredAddon[]>('media_configuration_add', { manifestUrl });
    return addons;
  });
}

export async function importInstalledStremioConfiguration(): Promise<StremioImportResult> {
  if (!isNativeShell()) throw new Error('Installed Stremio import is available in the desktop app');
  return serializeMediaConfiguration(async () => {
    const result = await invoke<StremioImportResult>('media_configuration_import_stremio');
    return result;
  });
}

export async function removeMediaConfiguration(addonId: string): Promise<ConfiguredAddon[]> {
  if (!isNativeShell()) throw new Error('Protected media configuration is available in the desktop app');
  return serializeMediaConfiguration(async () => {
    // The resource a removed add-on provided is settled by that removal, so the
    // next read must not append a bundled default in its place. Without a
    // snapshot the resources are unknown; an explicit removal then silences all
    // three rather than re-adding one the user just got rid of.
    let settledResources: readonly MediaDefaultResource[] = MEDIA_DEFAULT_RESOURCES;
    try {
      const before = await invoke<ConfiguredAddon[]>('media_configuration_status');
      settledResources = declaredDefaultResources(before.find((addon) => addon.id === addonId));
    } catch {
      // Keep the conservative fallback above.
    }
    const addons = await invoke<ConfiguredAddon[]>('media_configuration_remove', { addonId });
    recordDefaultSeeds(settledResources);
    return addons;
  });
}

export async function disconnectMediaConfiguration(): Promise<void> {
  if (!isNativeShell()) return;
  return serializeMediaConfiguration(async () => {
    await invoke('media_configuration_disconnect');
    // Disconnect is a deliberate emptying: no bundled default is re-seeded.
    recordDefaultSeeds(MEDIA_DEFAULT_RESOURCES);
  });
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
