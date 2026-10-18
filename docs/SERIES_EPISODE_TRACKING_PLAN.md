# Series episode identity and progress tracking — plan

**Status:** owner-directed, awaiting the first delegated run. The two product
choices below are decided (2026-10-18); everything else in this document is the
frozen contract the parts are built against, not an open question.

**Repository:** `/home/illan/Documents/coding/locadora-app` (desktop).
The shared backend (member-data Worker, web repo) **may** be changed when a
feature genuinely needs it — but this plan deliberately needs none of it, and
that is a cost decision, not a boundary. Player, torrent and stream code never
migrates to the web repo.

---

## 1. Goal

Make a series watchable episode by episode, and make the app remember where the
user is.

Acceptance, in the owner's words: open the app, find the series tape, and within
a minute be watching the next unwatched episode — "I don't know if I'm on
season 16, I want the app to know."

Rentals are untouched: a series is rented once as a title (§3.3 of
`WILLS_LOCADORA_PLAYER_PLAN.md`), an episode is a playback entity, and a series
never splits into per-episode rentals.

## 2. What exists today

Verified in this tree; these are the constraints the parts work within.

- **There is no episode identity anywhere.** Stream and metadata requests are
  built as `ResourcePath::without_extra(&resource, &content_type, &id)`
  (`src-tauri/src/commands.rs:1316`) and the id is the bare IMDb id —
  `resolveTitleMedia()` passes `contentType: title.identity.type` and
  `id: imdbId` (`src/media/resolutionService.ts:66-69`). A `grep` for
  `season|episode` across `src/` returns only `src/locadora/fixture.ts`
  test fixtures. Torrentio expects `tt1234567:16:5` for a series episode, so
  series playback is currently unrequestable at the identity level.
- **The `meta` resource is already allowed** by the native allowlist
  (`commands.rs:1303`: `stream | subtitles | meta`), so an episode list can be
  fetched through the existing `fetch_configured_addon_resource` path with no
  new native command and no backend route.
- **The player already reports what a progress rule needs**: `time`,
  `duration` and `ended` are in the player state and `ended` is a subscribed
  event (`src/media/useStremioVideo.ts:22-23,37,253`). No new native command is
  required to auto-mark an episode.
- **D-006** stands: series use the manual source picker, no episode/next-episode
  autoplay, no season-pack selection — this plan keeps that and only adds the
  *identity* and the *bookkeeping* around it.
- **D-005** stands for now: nothing about playback position is persisted. This
  plan persists episode-level progress locally (§7.3); that is an owner-approved
  narrowing of D-005 and must be recorded as a new decision entry, not silently
  assumed.
- Local persistence precedent: `src/locadora/localCache.ts` (IndexedDB,
  `CACHE_VERSION = 2`, stores `titles`/`shelves`, `keyPath: 'key'`, index
  `savedAt`).

## 3. Decided product choices (2026-10-18)

1. **Episode lists come from a bundled meta add-on.** Cinemeta-style public
   manifest, no credentials, verified to serve `meta` for `series` with an
   IMDb `tt` id (`https://v3-cinemeta.strem.io/manifest.json` declares
   `resources: ["catalog","meta","addon_catalog"]`, `types: ["movie","series"]`,
   `idPrefixes: ["tt"]`). No Worker route, no web-repo change.
2. **Watching is marked automatically near the end of an episode, with a manual
   override.** Auto at ≥90% of `duration` or on `ended`; the episode list lets
   the user mark/unmark by hand.
3. **Rent by title, track by episode.** No rental-model change.

## 4. Frozen contract

### 4.1 Episode identity

```text
series content id   tt0182576                 (unchanged; used for `meta`)
episode video id    tt0182576:16:5            (used for `stream` and `subtitles`)
```

- Composition happens once, in one pure helper
  (`episodeVideoId(imdbId, { season, episode })`), never inline at call sites.
- `season` and `episode` are integers, `season >= 1`, `episode >= 1` for normal
  episodes; season `0` (specials) is parsed but hidden by default.
- The series' IMDb id must match `^tt[0-9]{5,9}$`; a series without an IMDb id
  cannot offer episode playback and says so plainly.

### 4.2 Episode list shape

`GET meta/series/<imdbId>` → bounded parse into:

```text
SeriesEpisodes
- seasons: [{ season: number, episodes: BoundedEpisode[] }]     // max 40 seasons
- BoundedEpisode = { season, episode, name?: string (<=120), released?: string (ISO date) }
```

Bounds: at most 40 seasons, at most 300 episodes in total, drop malformed or
duplicate entries, never surface a raw add-on payload. `meta.videos[]` is the
source; entries with a missing/non-numeric `season`/`episode` are dropped.

### 4.3 Progress record

Server-shaped on purpose (see §7.3), stored locally for now:

```text
ProgressRecord
- seriesId: string            // tt0182576
- season: number              // last touched
- episode: number
- watched: Record<"S:E", ISO> // bounded to 500 entries, oldest pruned
- updatedAt: ISO
```

Storage: new IndexedDB store in the existing database by extending
`src/locadora/localCache.ts` — store name `progress`, same `keyPath: 'key'`
convention, key `progress:<seriesId>`. **Bump `CACHE_VERSION`** in the same
change; a stale record from an older shape must be ignored rather than
misread (the repo's established pattern, with a test that writes a
legacy-keyed record and asserts it is ignored).

### 4.4 What marks an episode watched

- Automatic: `time / duration >= 0.9`, or `ended`. One write per
  (season, episode) per session — no repeated writes while playback continues.
- Manual: an explicit toggle in the episode list; it writes the same record.
- Neither path touches rentals, returns, reviews or donations (AGENTS.md).

### 4.5 Where the UI lives

- Series tape inspection gains a season selector + episode list with watched
  state and one primary action: **Continuar T16E05** (or **Começar T01E01** when
  nothing is watched). 2D first; immersive parity is explicitly out of scope
  for these parts.
- Manual source picking stays as it is (D-006): the episode action resolves
  streams for the composed id and opens the existing source picker.

## 5. Parts

Each part is one delegated run, one brief, verified on its own. Do not start a
part before the previous one is committed and its checks are green.

### Part 1 — episode list (data only)

Scope: pure parse module + fetch through the existing metadata path + bundled
Cinemeta default.

- `src/media/seriesEpisodes.ts` (new): `parseSeriesEpisodes(payload)` →
  `SeriesEpisodes` per §4.2, plus `nextEpisode(episodes, progress)` helpers
  (pure, no UI).
- Bundled default: extend the default media configuration with the Cinemeta
  manifest (public URL only, no credentials), keeping D-003/D-011 override
  behaviour — never overwrite a non-empty user configuration, and keep the
  read-only Stremio import working.
- Fetch path: reuse `fetch_configured_addon_resource` with
  `resource: 'meta'`, `content_type: 'series'`, `id: imdbId`, chosen by add-on
  capability (`meta` support), not by hardcoded add-on id.

Exit criteria: unit tests for parsing (malformed, oversized, missing season/
episode, specials, duplicates) and for `nextEpisode` (nothing watched, mid
season, season boundary, series finished, gaps in the watched set); the bundled
default appears for a fresh profile and never replaces an existing
configuration.

Must not: touch the player, the stream path, the inspector UI, or rentals.

### Part 2 — episode playback

Scope: compose the episode id and play it.

- `episodeVideoId()` helper + `resolveTitleMedia()` gains an optional
  `{ season, episode }`; when present the request id is composed and the
  content type stays `series`.
- Series tape inspection: season selector + episode list (unwatched state is
  whatever Part 3 provides; before Part 3, all episodes simply show as
  unwatched), selecting an episode resolves and opens the existing
  `WatchFlow` + manual source picker.
- Failure states: no metadata add-on, no IMDb id, no episodes for the season,
  no stream candidates — each with its own message, matching the existing
  `no-sources` / `addon-unavailable` vocabulary.

Exit criteria: table tests that the resource path carries `tt…:S:E` for
series and stays bare for movies; a film's flow is unchanged (existing suite
green); the inspector shows the right seasons for a fixture series.

Must not: implement next-episode autoplay, season packs, or series Quick Watch
rules (D-006 still holds).

### Part 3 — progress and continue

Scope: remember, and resume.

- Progress store per §4.3 with the `CACHE_VERSION` bump and a legacy-record
  test.
- Auto-mark per §4.4, driven by the existing `time`/`duration`/`ended` state.
- Manual override in the episode list.
- **Continuar T16E05** as the primary action on the series tape; the episode
  list shows watched/unwatched.
- Clearing local data clears progress (same path as the existing local cache).

Exit criteria: tests for the marking threshold (89% does not mark, 90% does,
`ended` marks), one-write-per-episode, manual toggle, `nextEpisode` after a
season boundary, and progress surviving an app restart (IndexedDB, not memory).

Must not: send anything about watch history to Locadora services, or persist
playback *position* (D-005 still governs position; this part stores which
episode, not where inside it).

## 6. Cross-cutting constraints

- `AGENTS.md` scope: app repo only for code; the web repo receives nothing.
- Playback never mutates rentals, returns, collections, reviews, donations.
- Add-on manifests and `meta` responses are untrusted, bounded input.
- No credentials, playback URLs or descriptors in logs, fixtures, tests.
- No new dependency without saying so in the brief's proof block.
- English code, PT-BR user copy (EN alongside, per the existing i18n pattern).

## 7. Notes for later

### 7.1 Web parity (owner: "I'll put this in web later as well")

The record in §4.3 is deliberately server-shaped (`seriesId`, `season`,
`episode`, `watched`, `updatedAt`) rather than UI-shaped, so web parity later
does not require a data migration. Two follow-ups belong to that later piece,
not to these parts:

- progress on the member-data Worker (one row per user+series), with the
  privacy decision D-005 deferred finally made;
- either a one-shot upload of local records on first sign-in, or a
  merge-by-`updatedAt` rule.

Local-only progress means app and web will disagree until that lands. That is an
accepted, temporary state — not a bug to work around now.

### 7.2 Known unknowns to resolve during Part 1

- Whether the bundled default configuration is seeded before or on the first
  media request, and what a user with only stream add-ons sees (the inspector
  must degrade to "no episode list available", not to a broken screen).
- Cinemeta's `videos[]` for very long-running series (Family Guy has 20+
  seasons): confirm the payload stays inside the existing bounded-response
  limits, or lower the parse bounds.

## 8. Delegation protocol

- **One part per Codex run, never two at once on this repo.**
- Brief per part, written to a file, containing: read order (`AGENTS.md` →
  `WILLS_LOCADORA_PLAYER_PLAN.md` → `IMPLEMENTATION_PROGRESS.md` →
  `docs/DECISIONS.md` → this plan), the part's scope quoted from §5, the frozen
  contract from §4, the must-not list, and the proof block.
- The run records the owner's priority change in `IMPLEMENTATION_PROGRESS.md`
  and adds the decision entry (episode identity + local progress narrowing
  D-005) to `docs/DECISIONS.md` under the next free `D-0NN`.
- Proof block every run: `npm run check` tail with the real Vitest counts,
  `cargo test` + clippy when Rust is touched, `git status` before/after,
  `git diff --stat` of its own files, a short data-flow walkthrough, and an
  explicit list of every choice the brief left open.
- No push, no history rewrite, no browser/GUI automation, no manual visual or
  playback claims.
