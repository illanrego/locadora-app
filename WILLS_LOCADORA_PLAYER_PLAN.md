# Will's Locadora Player — implementation plan

**Status:** proposed; no implementation authorized in this repository  
**Date:** 2026-09-22  
**Intended destination:** a new, separate repository  

This document is designed to be moved into the new project. The existing `locadora` repository remains the public discovery website and must not receive torrent, playback, subtitle, debrid, or Stremio-account functionality.

## 1. Product definition

Build a desktop Will's Locadora application whose browsing presentation is effectively identical to the current live web Locadora:

- the same VHS-store visual identity;
- movie/series selection;
- genre and year-range shelves;
- normal and immersive browsing where supported;
- Cesta, Balcão, rentals, returns, saved titles, reviews, account, and donations;
- Portuguese and English interface;
- accessible non-3D browsing remains fully functional.

Stremio-compatible technology is an invisible media engine. The user does not choose a Stremio catalogue or see Stremio's Board/Discover interface.

```text
Locadora/TMDB discovery
    -> selected title and IMDb identity
    -> installed/configured Stremio-compatible stream add-ons
    -> normalized stream candidates
    -> Quick Watch rule engine
    -> native player
```

## 2. Confirmed product decisions

### Presentation and discovery

- Recreate the current Locadora presentation rather than wrapping or reskinning Stremio Web.
- Keep one broad movie/series catalogue with the existing genre and year-range experience.
- Do not expose a Stremio catalogue chooser.
- Remove subscription-provider filters and provider-first browsing.
- Continue using Locadora/TMDB discovery for reliable year, genre, poster, and title metadata.
- Use IMDb IDs as the normal bridge from a selected Locadora title to compatible stream add-ons.
- Do not claim that catalogue presence guarantees a playable source.

### Locadora domain

- Preserve separate Locadora membership and data.
- Preserve the rental ritual and its three-active-title server rule.
- Preserve `watched`, `not_watched`, and `unknown` returns.
- Preserve Assistir depois, Favoritos, reviews, and donations.
- Playback must not automatically return a rental or mark it watched.
- Continue accessing Locadora member data through its private API; never ship a Supabase service-role key.

### Media behavior

- The initial preferred resolution is 1080p.
- Fall back to 720p according to the Quick Watch rules below.
- Torrentio is expected to be the user's principal stream-result add-on, but the engine must consume the standard Stremio add-on protocol rather than hard-code Torrentio internals.
- Do not scrape torrent sites directly.
- Source names such as The Pirate Bay or RARBG are metadata used to rank candidates already returned by the user's configured add-on.
- Keep a manual source picker as a fallback whenever Quick Watch cannot make a safe deterministic choice.

### Subtitles

- Show Portuguese and English subtitle tracks by default.
- Normalize common language aliases such as `pt`, `por`, `pob`, `pt-BR`, `pt-PT`, `en`, and `eng`.
- After a subtitle is selected, immediately open the on-screen delay adjustment.
- Remember subtitle delay per video/file fingerprint, not globally per movie.
- Retain a deliberate way to reveal other subtitle languages if the preferred tracks are unavailable; final UI wording requires approval.

## 3. Architecture

### 3.1 Application layers

```text
Locadora React UI
    |
    +-- Locadora domain adapter
    |   +-- public discovery API
    |   +-- Better Auth session
    |   +-- member-data Worker
    |   +-- rentals/reviews/collections/donations
    |
    +-- Media engine adapter
        +-- Stremio core/add-on protocol
        +-- configured manifests
        +-- stream/subtitle normalization
        +-- Quick Watch rules
        +-- native player bridge

Native shell
    +-- Linux: GTK/WebKitGTK + libmpv or equivalent reviewed shell
    +-- Windows: WebView2 + mpv shell built from licensed components
```

### 3.2 Ownership boundaries

`LocadoraState` owns:

- member identity;
- Cesta and Balcão;
- active rentals and return state;
- saved collections;
- reviews;
- donations;
- current discovery filters and visual preferences.

`MediaState` owns:

- configured add-on manifests;
- selected title/video identity;
- stream candidates;
- Quick Watch result;
- player lifecycle;
- audio and subtitle tracks;
- subtitle delay;
- local playback position if resume is enabled.

A Locadora API failure must not corrupt playback state. A media/add-on failure must not mutate confirmed rentals or reviews.

### 3.3 Content identity

Use an internal content identity rather than making either TMDB or IMDb the database primary key:

```text
content
- id: internal UUID
- type: movie | series

external_identity
- content_id
- namespace: tmdb | imdb | stremio | addon
- external_id
```

Rules:

- Locadora discovery normally starts with a TMDB ID.
- Stream lookup normally uses the confirmed IMDb ID.
- A series is the rental/review/save entity.
- An episode is a playback entity and must not become a separate Locadora title.
- A title without a confirmed mapping may be inspected but must not silently create the wrong rental/review record.

The initial release may bridge the existing Locadora `movie|series:TMDB_ID` keys rather than migrating production data immediately. The internal identity layer should make a later migration possible.

## 4. Authentication and local secrets

There are two independent sessions:

### Locadora session

- Needed only when the user rents, returns, saves, reviews, or opens member history.
- Uses the existing Better Auth and private data Worker contract.
- Remains optional for anonymous public browsing.

### Stremio/media session

- Needed when the user wants their Stremio-synchronized add-ons, library, or preferences.
- May be avoided if the user configures compatible add-on manifest URLs locally.
- Must never be transmitted to the Locadora backend.

Configured manifest URLs may contain private add-on or debrid credentials. Therefore:

- store them only in protected local application storage;
- redact them from logs, crash reports, analytics, tests, and screenshots;
- never store them in Supabase;
- never include them in repository fixtures;
- provide a clear disconnect/delete-local-configuration action.

The first integration spike must determine whether Stremio account synchronization or local manifest configuration is the safer initial route. The product should not require both logins merely to browse Locadora.

## 5. Quick Watch v1 specification

### 5.1 Normalized candidate

Every add-on stream response is normalized into:

```text
StreamCandidate
- stableId
- addonId
- sourceName
- resolution
- sizeBytes
- seeders
- transportType
- displayName
- playbackDescriptor
- parseConfidence
- rejectionReasons[]
```

Normalization rules:

- Prefer structured fields when present.
- Parse Torrentio-style display text only in a dedicated adapter.
- Never parse or log secret query parameters from playback URLs.
- Normalize source aliases without contacting those sources directly.
- Candidates with ambiguous resolution, size, or seeder data remain available in the manual picker but are not automatically selected in v1.

Source aliases should initially recognize:

1. The Pirate Bay: `TPB`, `The Pirate Bay`
2. RARBG: `RARBG`
3. YTS/YIFY: `YTS`, `YIFY`
4. 1337x: `1337x`

The user's spelling `ytfs` is interpreted as **YTS/YIFY** and must be confirmed before implementation.

### 5.2 Movie priority ladder

Quick Watch uses lexicographic tiers rather than a single opaque score. A candidate in a better tier always beats a candidate in a lower tier.

#### Tier 1 — preferred 1080p

- Resolution: exactly 1080p.
- Size: 500 MB through 2 GB, inclusive.
- Seeders: at least 10.

Within this tier:

1. higher seeder count wins;
2. preferred source order breaks a tie: Pirate Bay, RARBG, YTS/YIFY, 1337x, then other sources;
3. smaller size breaks a remaining tie;
4. stable candidate ID provides the final deterministic tie-break.

#### Tier 2 — larger 1080p

- Resolution: exactly 1080p.
- Size: over 2 GB through 5 GB, inclusive.
- Seeders: at least 10.

Ranking inside the tier is the same: seeders, source preference, smaller size, stable ID.

#### Tier 3 — 720p fallback

Enter this tier only when no Tier 1 or Tier 2 candidate has at least 10 seeders.

- Resolution: exactly 720p.
- Prefer 500 MB through 2 GB.
- Then allow over 2 GB through 5 GB.
- Prefer candidates with at least 10 seeders.
- Rank by size bucket, seeders, source preference, smaller size, then stable ID.

#### No automatic winner

Do not autoplay when:

- no 1080p or 720p candidate can be normalized confidently;
- every candidate has unknown size or unknown seeders;
- every remaining candidate fails validation;
- the add-on request times out or returns conflicting results.

Open the manual source picker and explain why Quick Watch did not choose.

### 5.3 Explicit examples

- 1080p, 1.4 GB, 80 seeders from 1337x beats 1080p, 1.2 GB, 40 seeders from Pirate Bay because seeders outrank source preference inside the same size tier.
- 1080p, 1.8 GB, 10 seeders beats 1080p, 3 GB, 300 seeders because the preferred 500 MB–2 GB tier comes first.
- 1080p, 1.5 GB, 9 seeders does not qualify for autoplay; a qualifying 720p candidate is considered instead.
- Two otherwise equal candidates use the configured source order, then smaller size, then stable ID.

### 5.4 Series rule is not yet defined

The user specified the 500 MB–2 GB preference for movies. Do not silently apply movie sizes to individual episodes.

Before series Quick Watch is implemented, agree on:

- preferred episode size range;
- whether season packs are excluded;
- minimum seeders for episodes;
- whether 1080p-to-720p fallback follows the movie threshold;
- autoplay behavior for the next episode.

Until then, series should use the manual source picker or an explicitly approved conservative rule.

### 5.5 Rule configuration

- Store the rules as versioned declarative configuration interpreted by a pure evaluator.
- Do not distribute the logic across UI components.
- Every selection returns both the winner and an explanation.
- The same normalized candidates plus the same rule version must always produce the same result.
- Remote add-on results may change; determinism applies to identical input, not forever across different responses.

## 6. Player behavior

Use an explicit state machine:

```text
idle
-> resolving identity
-> loading streams
-> normalizing candidates
-> applying Quick Watch
-> buffering
-> playing
-> paused
-> ended | failed
```

Required behavior:

- visible cancellation while loading streams;
- bounded add-on timeouts;
- manual source switch without losing the Locadora title context;
- retry after source failure;
- clear distinction between “no source,” “add-on unavailable,” and “playback failed”;
- no automatic rental mutation from player events;
- local resume state only after its privacy behavior is approved;
- keyboard and remote-friendly playback controls;
- accessible labels for every player action.

## 7. Subtitle and audio plan

### Subtitle selection

- Present Portuguese first, then English.
- Group duplicate language tracks while preserving meaningful labels such as CC, SDH, source, and release variant.
- After applying a track, open a compact on-screen delay control immediately.
- Support keyboard decrease/increase shortcuts as well as direct numeric adjustment.
- Store delay against a fingerprint composed from video hash/file identity plus subtitle track identity.
- Clear or ignore a remembered delay when the video fingerprint changes.

### Audio

- Preserve the media file's default audio unless the user defines a preference.
- Do not infer audio language from torrent source names alone.
- Later settings may prefer Portuguese or English audio independently from subtitle language.

### Automatic subtitle synchronization

Automatic speech-based synchronization is not part of v1. The initial feature is immediate manual delay adjustment. Auto-sync requires a separate feasibility and performance study.

## 8. UI parity requirements

Before media integration, record the current live Locadora interface as a parity checklist:

- header, navigation, and language behavior;
- genre and year plaque behavior;
- movie/series presentation;
- shelf and VHS appearance;
- title inspection;
- Cesta and Balcão flow;
- account panels, rentals, returns, saved titles, and reviews;
- donation surfaces;
- normal-mode keyboard/accessibility flow;
- immersive-mode enhancement and fallback.

The new application may change implementation technology, but not these visible product concepts without explicit approval.

There must be no visible:

- Stremio Board;
- Stremio catalogue selector;
- subscription-provider filter;
- tracker/source selector during ordinary Quick Watch success;
- duplicate Locadora and Stremio libraries competing in navigation.

Add-on configuration and manual source selection belong in secondary settings/fallback surfaces.

## 9. Security boundaries

- Treat all add-on manifests and responses as untrusted input.
- Allow only explicitly supported network and playback schemes.
- Apply response-size limits and timeouts.
- Prevent arbitrary privileged proxying through the native shell.
- Keep web UI and native IPC commands narrowly allowlisted.
- Redact credentials and playback URLs from logs.
- Do not expose local files through the webview.
- Disclose P2P behavior and the fact that peers may observe the user's IP.
- Do not bundle private tracker/debrid credentials or configured manifests.
- Do not bundle or operate a tracker scraper; consume user-configured add-on results only.

## 10. Licensing strategy

Before implementation, produce a dependency/license inventory.

Preferred path:

- use MIT-licensed `stremio-core`/core-web where viable;
- implement the Locadora UI from scratch;
- do not copy Stremio Web GPL-2-only UI code into a GPL-3-only native-shell derivative without formal compatibility review;
- do not copy code from repositories that do not carry a clear license;
- do not redistribute Stremio `server.js` until its redistribution terms are confirmed;
- keep third-party copyright notices and corresponding source obligations with every binary release;
- use Will's Locadora branding, not official Stremio branding.

The implementation license should be selected only after the shell/player dependencies are fixed. GPL-3.0-compatible licensing is the likely safe default if the GPL-3 Linux shell is derived, but this is not legal advice and must be reviewed before release.

## 11. Distribution targets

### Linux

Order:

1. Flatpak as the primary cross-distribution package.
2. Debian `.deb` for the user's main development system.
3. AppImage only after GTK/WebKitGTK/mpv and codec portability is proven.

Linux acceptance includes:

- hardware-accelerated playback where supported;
- Wayland and X11 behavior;
- desktop launcher and protocol handling;
- correct local storage permissions;
- clean uninstall behavior for secrets and caches;
- documented codec limitations.

### Windows

- Build a licensed WebView2 + mpv shell or use another clearly licensed foundation.
- Produce a signed installer when public distribution begins.
- Support x64 first; ARM64 is later unless the dependency chain is already proven.
- Keep the same React UI and Quick Watch engine as Linux.
- Isolate platform-specific player/IPC code behind one interface.

Do not base the Windows release on `stremio-shell-ng` unless its license grants the required rights.

## 12. Delivery phases

### Phase 0 — evidence and licensing spike

- Create the new repository with no production credentials.
- Lock the chosen licenses and third-party notices.
- Verify the Stremio core/add-on client path independently of Stremio Web UI code.
- Verify a native mpv bridge on Debian.
- Capture sanitized Torrentio response fixtures from the user's actual configuration.
- Confirm which fields reliably expose resolution, size, seeders, source, hash, and subtitles.
- Confirm whether `ytfs` means YTS/YIFY.
- Decide Stremio login synchronization versus local manifest configuration.

Exit criteria:

- one public-domain test title resolves metadata, stream candidates, and subtitles;
- no token or private manifest appears in logs/fixtures;
- license review identifies no unlicensed copied component;
- the Quick Watch normalizer can parse the sanitized fixture deterministically.

### Phase 1 — application shell and Locadora visual skeleton

- Scaffold the React UI and native shell boundary.
- Recreate the current Locadora header, browsing shell, plaque, shelves, tape inspection, and accessible normal mode.
- Connect the public discovery API without provider filters.
- Implement movie/series, genre, year-range, pagination, locale, and error states.
- Keep playback disabled behind a clearly marked development action.

Exit criteria:

- browsing presentation is approved as Locadora, not Stremio;
- current genre/year behavior matches the live product;
- no Stremio catalogue UI is visible;
- keyboard browsing works without Three.js.

### Phase 2 — Locadora member services

- Integrate Better Auth in the desktop-safe flow.
- Load profile, active rental, history, collections, and reviews through the private Worker.
- Preserve anonymous browsing and participation-time login.
- Integrate donations without introducing payment state into rentals.

Exit criteria:

- member state matches the web Locadora account;
- no direct Supabase access exists in the client;
- logout clears local Locadora session material without deleting media configuration.

### Phase 3 — media engine and add-on configuration

- Integrate the licensed core/add-on transport.
- Resolve selected TMDB titles to confirmed IMDb IDs.
- Implement protected local manifest storage.
- Fetch streams and subtitles from the user's configured compatible add-ons.
- Add bounded loading, cancellation, and sanitized diagnostics.

Exit criteria:

- a selected Locadora title yields normalized candidates;
- no catalogue choice appears in normal browsing;
- private manifest data never reaches Locadora services.

### Phase 4 — Quick Watch movies

- Implement the pure versioned evaluator.
- Implement the exact Tier 1/Tier 2/720p ladder.
- Provide an explanation object for every selection or fallback.
- Add the manual source picker for unresolved cases.
- Add settings to disable Quick Watch without changing the default rules.

Exit criteria:

- table-driven fixtures prove all priority and boundary cases;
- 500 MB, 2 GB, and 5 GB boundaries are exact and tested;
- 9 versus 10 seeders is tested;
- source aliases and tie-breaking are tested;
- identical inputs always produce the same winner.

### Phase 5 — native playback, audio, and subtitles

- Load the selected stream through the native player bridge.
- Implement player lifecycle, retries, and source switching.
- Add PT/EN subtitle filtering and track labels.
- Open subtitle delay immediately after selection.
- Persist delay by video/subtitle fingerprint.
- Preserve accessible keyboard controls.

Exit criteria:

- playback failure returns safely to title/source state;
- changing sources does not mutate Locadora rental state;
- subtitle delay does not leak across different releases;
- PT/EN defaults and the other-language fallback are verified.

### Phase 6 — Linux packaging

- Package and verify Flatpak first.
- Add the Debian package.
- Evaluate AppImage only after dependency portability tests.
- Add corresponding source, license, notices, and reproducible build instructions.

### Phase 7 — Windows shell and installer

- Implement the platform adapter with WebView2 and mpv from clearly licensed components.
- Reuse the same UI/media contracts and rule fixtures.
- Add Windows installer, update strategy, local-secret storage, and signing plan.

### Phase 8 — series Quick Watch

- Agree on episode-specific size and seeder rules.
- Handle episode IDs, season packs, next-episode behavior, and subtitle identity.
- Implement only after movie selection is stable.

## 13. Verification strategy

### Unit tests

- ID mapping and series/episode separation.
- resolution, byte-size, seeder, and source normalization.
- all Quick Watch tiers and boundaries.
- deterministic tie-breaking.
- PT/EN language normalization.
- subtitle-delay fingerprinting.
- secret redaction.

### Contract tests

- sanitized Stremio manifest and stream fixtures.
- malformed, oversized, delayed, and partial add-on responses.
- Locadora public/member API response contracts.
- native IPC allowlist and error responses.

### Integration tests

- discovery to IMDb mapping to candidate list.
- Quick Watch to native player load.
- manual fallback after no automatic winner.
- source failure and retry.
- Locadora login/logout independent from media configuration.
- subtitle selection to immediate delay control.

### Packaging checks

- no credentials in built artifacts;
- complete license/notice bundle;
- Flatpak sandbox permissions are minimal;
- Windows and Linux use the same Quick Watch fixtures;
- uninstall/cache-clearing behavior is documented.

The user will perform manual visual/playback testing when explicitly requested. Automated and static checks should not be reported as evidence of public playback availability.

## 14. Decisions still required before implementation

1. Confirm that `ytfs` means **YTS/YIFY**.
2. Define 720p behavior when no 720p candidate has at least 10 seeders: manual picker or select the highest-seeded candidate anyway.
3. Define episode size/seeder rules and season-pack handling.
4. Choose Stremio account sync, local manifest configuration, or both for the first release.
5. Decide whether non-PT/EN subtitles are hidden completely or exposed through an “other languages” action.
6. Decide whether local resume history is wanted and how long it is retained.
7. Approve the final native shell/dependency license inventory.

No implementation should begin until these decisions and the Phase 0 licensing boundary are approved in the new repository.
