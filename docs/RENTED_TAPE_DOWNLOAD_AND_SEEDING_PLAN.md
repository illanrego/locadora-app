# Rented tape download and seeding — design plan

**Status:** proposed. Owner-directed, not yet implemented, not yet an accepted
decision. No code may be written from this document until the owner approves it
and the first run records the priority change in `IMPLEMENTATION_PROGRESS.md`
plus a new `D-0NN` entry in `docs/DECISIONS.md`.

**Repository:** `/home/illan/Documents/coding/locadora-app`

**Web repo:** `/home/illan/Documents/coding/locadora` stays read-only and
receives nothing from this plan — no torrent, seeding, queue or player code.

---

## 1. What this adds

Today a rented tape is a **catalogue and ritual** fact: you rent a title, the
rental is stored server-side, and `Assistir` streams that title through the
engine's RAM path. Nothing is downloaded and nothing is given back.

This plan adds a second, parallel behaviour: a rented tape is **actually
downloaded** by the app, kept on disk for the life of the rental, played from
that finished copy once it exists, and seeded back to the swarm while it is
kept. Returning the tape deletes the copy and stops seeding.

Four product statements, in the owner's own terms:

1. Every Locadora user receives the Stremio core and the stream add-ons the app
   already uses. Nothing to configure, no add-on URL to paste, no manifest
   chooser. Discovery, source search, rendering and playback are all bundled.
2. `Assistir` keeps choosing a probable suitable source itself (the existing
   Quick Watch ladder). The user is not asked to pick a torrent.
3. A rented tape downloads in a queue, one at a time, using the same source
   `Assistir` would have picked, and then seeds the way any torrent client
   seeds.
4. Once the download finishes, playback prefers the finished file. Until then
   it uses the existing RAM path.

## 2. What must not change

- **The current `Assistir` path stays exactly as it is.** RAM-only piece cache,
  no retention, 30 s torrent reclaim, nothing written to disk. The rental path
  is a new path wired alongside it, never a modification of it.
- `Assistir` on a title that is **not** rented still behaves byte-for-byte as
  today.
- Playback still never mutates rentals, returns, collections, reviews or
  donations. The engine gains an obligation, the *player* does not — see §5.
- Player URL policy, native IPC allowlist, secret redaction, exact CORS origins
  and the no-secrets-in-artifacts rule all stay. Where this plan needs to touch
  one of them it says so explicitly (§13).
- Two browsing states stay independent of media state (`AGENTS.md`).

## 2.1 Standing constraint: designed for a weak connection (owner, 2026-10-18)

Not a preference — a design target. Assume a weak-to-medium Brazilian
residential link, on a laptop of the same vintage as the owner's. Better
hardware and better internet are a bonus, never the thing we design for; the
meek have to survive *and* contribute.

- **The link is scheduled, not shared.** One substantial network activity at a
  time, strict priority: playback > queue download > seeding. Nothing in this
  plan runs concurrently with a stream — including the queue (§11).
- **Contribution must be possible at the low end.** The upload cap is expressed
  as a fraction of measured upstream capacity, not a fixed number, because
  Brazilian upstream is often a small fraction of downstream. A give-back of
  hundreds of megabytes in an evening is a normal, successful outcome.
- **Nothing may assume bandwidth the user does not have:** no parallel
  downloads, no prefetching the next tape while streaming, no background
  catalogue refresh during playback, no eager per-title metadata fetching on
  top of an active stream.
- **Honest progress, honest numbers.** The dashboard's queue message states the
  real expected wait for the user's measured throughput, never an optimistic
  constant.

## 3. The two paths

| | `Assistir` (existing) | Rented tape (new) |
|---|---|---|
| Trigger | Playback of any title | The rental action itself |
| Engine instance | A — stream engine, port 11471 | B — tape engine, port 11472 |
| Piece storage | in-RAM, 256 MiB, evicted | on disk, permanent while rented |
| Retention | none | full file, for the rental's lifetime |
| Torrent lifetime | 30 s idle reclaim | until return/expiry |
| Upload | incidental | enabled, `seedingEnabled=true`, unlimited ratio |
| Playback source | engine stream URL (pieces arrive live) | finished file first, engine stream while downloading |
| Mutates rentals | never | no — the rental row owns it (§5) |

Both paths use the same Quick Watch evaluator and the same normalizer. There is
no second ranking implementation.

## 4. Tooling facts this design must respect

Verified against the vendored engine at
`.local/engine-audit/stremio-server-go-0.16.1` (v0.16.1, pinned by D-018) and
the app's current engine supervisor. These are constraints, not opinions.

**Storage backend is process-wide, not per-torrent.**
`internal/engine/engine.go:293-295`: if `MemoryCacheSize > 0` the whole client
gets `newMemStorage` (RAM, `memstorage.go:9-10`, "piece data not written to
disk"); otherwise it gets `storage.NewFileByInfoHash(cfg.CacheRoot)`. There is
no per-torrent storage override — `types.AddOptions` carries only `MetaInfo`
and peer-search sources. **This is why the rental path needs its own engine
process and not a flag on the existing one.**

**Disk root is `CacheRoot`, defaulting to `APP_PATH`.**
`types.go:18` and `app.go:109`. The app currently sets `APP_PATH` to a
per-session directory (`streaming_engine.rs:105-107`) and deletes it on drop
(`:238-241`, `fs::remove_dir_all(session)`). Any tape stored under that root
dies with the process. A persistent tape engine must point `APP_PATH` at a
durable, private directory instead.

**The engine already seeds by design.** `cc.Seed = true` (`engine.go:256`,
"keep uploading while/after streaming"), `seedingEnabled` defaults to `true`
(`settings.go:87-90`), and when false the upload limiter is pinned to 1 byte/s
(`app.go:277-282`) rather than dropping the torrent. `STREMIO_MAX_SEED_RATIO`
(`types.go:83-91`, `app.go:137`) caps upload by share ratio with `0 = unlimited`
and, importantly, **reaching the cap only pauses uploading — it never drops the
torrent or purges its pieces.** So a ratio cap is safe for retention.

**Retention vs reclaim is two separate knobs.**
`STREMIO_TORRENT_IDLE_TIMEOUT` (`types.go:77-82`, currently `30` s in the app)
removes a torrent that has had no reader for that long. Separately, a janitor
enforces a disk budget (`cacheSize`) by evicting least-recently-accessed
torrents once over budget, skipping a small grace window
(`engine.go:790-880`). A rented tape nobody has opened for a day is a top
eviction candidate — see the open question in §18.

**Return already exists in the engine's own vocabulary.**
`GET /{infoHash}/remove` (`api.go:584-588`) → `RemoveEngine` →
`beginPurge` → `t.Drop()` plus `os.RemoveAll(e.path)` (`engine.go:476-503`).
One call stops seeding *and* deletes the tape. That is the return ritual.

**Nothing is resumed at startup.** Torrents exist only after `/create`
(`api.go:861`) or `/create?from=` (raw `.torrent` bytes, `api.go:963`). A
grep for resume/restore/rehydrate finds no start-up re-add. After an app
restart a retained tape is bytes on disk that no engine knows about, and the
metainfo (file layout) comes from peers, not from the piece files. The app must
therefore persist the descriptor and re-create the torrent itself (§8).

**Progress and upload are already observable.** `/{hash}/{fileIdx}/stats.json`
(`api.go:982`) carries `downloaded`, `uploaded`, `isSeeder`, peer and speed
fields (`types.go:203`, swagger `uploadSpeed`/`uploaded`/`isSeeder`).

**A full download needs a driver.** There is no "download everything" call;
`warmMoov`/`prefetchNext` only warm a header and a tail
(`engine.go:1151`, `1416`). A full sequential `GET /{hash}/{fileIdx}` drained
to EOF is what makes the engine request every piece — and the engine writes
those pieces into its own `CacheRoot/<infohash>` as they land. See §9.

**Inbound peering needs a fixed peer port.** The engine's own
`docs/CONTAINER.md:433-434` states that without an exposed, pinned port
"inbound peering and seeding are not possible" (outbound DHT/PEX/tracker still
work). The current app passes `ListenPort = 0` (OS-assigned). Real seeding —
other peers finding *us* — needs a pinned port; see §18.

## 5. Where the obligation lives

The rental row is the source of truth, and only the rental service writes it.

```text
rent (existing flow, server-enforced 1-10 limit, D-020)
    -> rental row created
    -> Locadora domain adapter enqueues a TapeJob {contentId, rentalId, imdbId}
    -> TapeQueue picks the best source with the EXISTING Quick Watch evaluator
    -> tape engine: /create, then drain to completion
    -> job state: queued | resolving | downloading(pct) | ready | seeding | failed | returned

return (watched | not_watched | unknown)
    -> rental row closed
    -> Locadora domain adapter issues /{hash}/remove on the tape engine
    -> file gone, seeds stop, queue slot freed
```

The player only **reads** job state to choose its source (§10). It never
creates, advances, closes or repairs a rental, and a player failure never
enqueues or cancels a download. This keeps `AGENTS.md`'s "playback events must
never mutate rentals" intact while letting the engine serve an obligation that
belongs to the domain.

Expiry (rental limit lowered, account removed, tape rented elsewhere): the
rental service reports the active set; any retained tape whose rental is no
longer active is returned locally. Retention never outlives the rental row.

## 6. Second engine instance

Add a second supervised engine, same binary, same `materialize()` provenance
path, different role. Suggested shape (`streaming_engine.rs` grows a role
parameter rather than a second copy of the supervisor):

| setting | stream engine (A) | tape engine (B) |
|---|---|---|
| port | 11471 (fixed, reserved) | 11472 (fixed, reserved, fail-closed) |
| `APP_PATH` | `…/streaming-engine/session-<pid>-<nonce>` (ephemeral) | `…/tape-store` (durable) |
| `STREMIO_MEMORY_CACHE_SIZE` | `268435456` (unchanged) | unset → `0` → disk |
| `STREMIO_TORRENT_IDLE_TIMEOUT` | `30` (unchanged) | `0` (disabled — the rental owns lifetime) |
| `STREMIO_MAX_SEED_RATIO` | unset | `0` (unlimited) or owner-chosen cap |
| `STREMIO_MEM_LIMIT` | `536870912` | `268435456` suggestion; measure on the Box |
| `STREMIO_DISABLE_WEBTORRENT` | `1` | `1` |
| listen port | `0` (as today) | pinned if §18 says yes |
| teardown | `remove_dir_all(session)` | never delete the store on drop |

Rules:

- Start B lazily — on the first rented tape, at earliest — not at app launch,
  so a user who never rents a tape pays nothing for it.
- B is stopped only by app exit or by an explicit owner action. Its directory
  is never wiped on drop; only per-tape `/{hash}/remove` deletes anything.
- Port conflicts stay fail-closed with a readable message, as today.
- No new native command is required for B's normal traffic: the app already
  bridges `fetch` for the engine origin and the allowlist permits
  `POST /<hash>/create`. B needs (a) its URL base constant, (b) the same
  narrowing for the player URL policy (§10), and (c) an allowlist entry for
  `GET /<hash>/remove` and `/<hash>/<idx>/stats.json` if not already covered.

## 7. Storage layout

```text
$XDG_DATA_HOME/com.illanrego.willslocadora/
  tape-store/                     APP_PATH / CacheRoot for engine B
    server-settings.json          engine-owned (mode 0600)
    <infohash>/                   piece files, owned by the engine
  tape-store.json                 app-owned manifest (mode 0600)
```

`tape-store.json` (app-owned, written atomically: tmp + fsync + rename):

```text
{
  "version": 1,
  "tapes": [{
    "rentalId": "...", "contentId": "...", "title": "…",
    "infoHash": "<40 hex>", "fileIdx": 3, "fileName": "movie.mkv",
    "sizeBytes": 1610612736,
    "descriptor": { "sources": ["udp://…"], "magnet": "magnet:?xt=…" },
    "torrentBytesB64": null,          // only when the add-on supplied a .torrent
    "state": "ready", "addedAt": "…", "completedAt": "…", "lastPlayedAt": "…"
  }]
}
```

- The descriptor is required for resume (§4) and is **the same kind of data the
  app already treats as private**: it never enters logs, fixtures, analytics or
  Locadora services. It is not a debrid credential; it is a public infohash plus
  public trackers, but it is still stored privately and redacted on error paths.
- One directory per infohash because the engine already partitions by infohash
  (`engine.go:441`).
- Nothing in the store is ever exposed to the WebView as a file path.

## 8. Lifecycle, resume, orphan handling

| event | expected behaviour |
|---|---|
| rent | job enqueued; B started if needed; descriptor written on first resolve |
| download completes | job `ready`; `completedAt`; file stays; seed continues |
| app restart | tape-store read; B started; each `ready` tape re-created via `POST /<hash>/create` with the stored descriptor so seeding resumes; a `downloading` tape re-created and re-queued |
| resume without peers | metainfo cannot be re-fetched → tape marked `unverified`, playback falls back to the RAM path, seeding impossible until peers appear; state is surfaced, never silently broken |
| return | `/{hash}/remove`; manifest row deleted; space freed |
| rental expired server-side | same as return, reconciled on next launch and on every rental-list load |
| store dir missing but manifest present | manifest row becomes `unverified` and is re-queued or dropped, never assumed playable |
| user uninstall | store dir removed with the app (document the path) |

## 9. Download queue

- **One active download.** FIFO by rent time. Rationale: the Box, a 1.5 GB
  tape, and a swarm that is faster when one torrent gets the whole connection.
  Concurrency is a later toggle, not a v1 field.
- **Bounded queue**: at most the active rental limit (max 10, D-020). A tape
  beyond that cannot exist because the rental itself is refused.
- **Source selection reuses Quick Watch verbatim** — same normalizer, same
  Tier 1/2/720p ladder, same "no automatic winner" rule. If Quick Watch would
  refuse to autoplay, the download job fails with the same explanation the
  player would show, and the tape stays stream-only. Do not invent a
  permissive second chooser for downloads.
- **The download itself** is a full sequential `GET /{hash}/{fileIdx}` against
  engine B, drained and discarded by the app; piece data lands in B's store.
  Progress = bytes read / `sizeBytes`, cross-checked against
  `/{hash}/{fileIdx}/stats.json` `downloaded`. This needs no engine change and
  no new engine endpoint.
- **Failure**: no source, engine down, disk full, no peers for N minutes →
  job `failed` with a reason; retried once on the next launch and on the next
  `Assistir` of that tape. Never a tight retry loop.
- **Disk admission** (owner, 2026-10-19): the engine's own budget is unlimited,
  so eviction can never remove a rented tape. The app owns the limit, and it is
  the **smaller of two numbers**: the user's own ceiling ("Locadora may use up
  to N GB for tapes", set in settings) and the free space minus a 2 GiB reserve.
  Insufficient space → job refused with a message; the rental still exists, the
  tape simply stays stream-only. A refusal never silently deletes a tape and
  never blocks the rental itself.
- **Cancellation**: returning a tape mid-download removes the engine torrent and
  deletes the partial directory.

## 10. Playback switch

**Owner decision (2026-10-18): Option A.** mpv opens the tape engine's URL over
its disk-backed store. Option B stays documented below as a rejected-on-cost
alternative, not as planned work.

Chosen at load time, from the job state, with no user-visible switch:

```text
job ready/seeding and file present     -> play the tape engine's copy
otherwise                              -> the existing RAM path, unchanged
```

Two implementation options for "play the tape engine's copy":

**Option A — same engine URL, disk-backed (recommended for slice 1).**
Play `http://127.0.0.1:11472/<hash>/<idx>` exactly as the stream path plays
`…:11471/<hash>/<idx>`. The engine serves the finished file from disk, seeking
is local, and seeding continues while watching. Requires only that the player
URL policy accepts the second port — a one-line predicate change next to the
existing `port() != Some(11471)` check (`crates/native-core/src/player.rs:342`),
covered by the existing rejection tests plus one new positive case. Zero new
file-access surface.

**Option B — local file path (possible later).** Hand mpv the store path
directly. Better for the pathological case where the engine is down or its
process crashed, but it is a genuine boundary change: the player currently
accepts only the engine's canonical `http://127.0.0.1:11471/<hash>/<idx>`
shape, and a filesystem path is a new scheme. It would need its own validation
— canonicalise, reject symlinks, require the resolved path to sit inside
`tape-store/`, no caller-supplied path — plus new tests. Not slice 1.

Neither option changes what the *player* knows about rentals: it reads a
read-only job snapshot.

## 11. What "seeding naturally" means here

**Owner direction (2026-10-18): the seeding window is "Locadora is open".**
Serving is tied to the app's own lifetime, not the rental's: watching a tape is
seeding it, closing the app stops serving immediately. Retention is a separate
clock — the file stays on disk for the whole rental, whether or not the app was
open. So: *disk lifetime = rental*, *serving window = app session*.

- Upload is on for engine B (`seedingEnabled=true`) with **unlimited ratio while
  the tape is rented** (owner, 2026-10-19): giving back is the point, and a ratio
  cap only pauses uploading — it never drops the torrent or its pieces. A cap
  remains available in settings as `STREMIO_MAX_SEED_RATIO` for anyone who wants
  one.
- **Upload bandwidth is capped by default** (owner, 2026-10-19): a share of
  *measured* upstream, default ~40%, because Brazilian upstream is a fraction of
  downstream and seeding must never starve what the user is watching. Unlimited
  upload is an explicit opt-in, not a default. The measurement is the app's own
  observed throughput for that engine, not a hardcoded number.
- Seeding runs while the app is open and the tape is rented — including while
  that tape is being watched from disk, including while another tape downloads,
  and including while the app sits idle on the shelf.
- **Closing the app ends serving.** Engine B is a child process and dies with
  the app; no daemon, no boot service, no background upload once the window is
  shut. Symmetrically, opening the app re-adds the retained torrents and
  serving resumes without user action.
- **The serving rule is a two-state machine, driven by what the player is
  doing.** Browsing, idling on the shelf, and queued downloading are all
  productive time: retained tapes seed and the queue advances.
  | player state | engine B |
  |---|---|
  | shelf / browsing / idle | seeding on, queue running |
  | playing a completed tape (local file) | seeding on — playback costs no network |
  | playing the RAM path (not downloaded) | seeding off entirely for the session, RAM stream proceeds unchanged |
  "Off entirely" means `seedingEnabled=false` on engine B, which the bundled
  engine already exposes as a runtime setting (`POST /settings`, bool key) and
  which pins the upload limiter to 1 byte/s without dropping a torrent or
  touching its pieces — so flipping it back on resumes serving with nothing
  lost. No engine change, no per-torrent pause API needed.
- **Consequence, stated as a rule:** the queue pauses while a RAM stream plays
  and resumes when playback ends. Downloading during that stream would recreate
  exactly the contention the seeding switch just removed.
- Seeding stops for that tape at return/expiry — `/{hash}/remove` is the only
  stop that also deletes.
- Restart resumes seeding only for tapes whose descriptor is still resolvable
  (§8).
- **The peer port is pinned** (owner, 2026-10-19): a 6881-class port, exposed in
  settings, so IPv4 peers can dial the tape engine and give-back is not limited
  to peers we happened to dial first. `BT_LISTEN_PORT` is the knob; the stream
  engine keeps its OS-assigned port because it never seeds deliberately. Because
  serving is bounded to app sessions, the pinned port is reachable only inside
  those sessions — the exposure window and the serving window are the same
  window, which is what makes the pin defensible rather than a permanent
  identifier.
- P2P disclosure stays as §9 of the product plan already requires: peers may
  observe the user's IP. This plan makes that disclosure load-bearing rather
  than incidental, so the wording gets a review before release.

### 11.1 The tape dashboard (part of the design, not a nicety)

The window is defensible and the deal becomes visible in the same place. Under
the Carteirinha (member card) — or its own small screen if the card gets
crowded — one row per retained tape:

| column | source |
|---|---|
| poster + title | local catalogue cache |
| state | job state (§9): queued / downloading % / ready / seeding / failed |
| size on disk | `sizeBytes`, plus the store total |
| uploaded | `stats.json` `uploaded`, per tape |
| session total | sum of `uploaded` while this app session was open |
| last played | manifest `lastPlayedAt` |

Also: total disk used vs the admission reserve, and one line of plain language
— "your rented tapes download here and share back while Locadora is open".
That sentence is the disclosure: the user reads it in the product, not in a
policy page.

Deleting from the dashboard is not a return. Return is a domain action and lives
where rentals already live; the dashboard may only explain state, never mutate
it.


## 12. Bundled defaults (opinionated delivery)

Target: a fresh install plays a rented tape without the user configuring
anything.

- Ship a default set of Stremio-compatible stream add-on manifests (Torrentio
  as principal, as `WILLS_LOCADORA_PLAYER_PLAN.md` §2 already expects) in the
  app, seeded into media configuration on first launch if the user has none.
- Keep D-003's local-manifest override and D-011's read-only Stremio import as
  user-facing overrides — bundled defaults are a floor, not a cage. A user who
  configures their own add-ons keeps them; we never overwrite a non-empty
  configuration.
- No catalogue chooser, no Board, no Discover, no provider filter — the same
  visible-product rules (§8 of the product plan) apply unchanged to the bundled
  set.
- **Subtitles: OpenSubtitles (the opensubs add-on), owner decision 2026-10-18.**
  Chosen over the opensubtitles.com variants because it is the stable,
  key-less option: no account, no API key, nothing to expire or bill. Any
  subtitles add-on that carries a credential is excluded by the rule below.
- **Owner-approved deviation** (2026-10-18): bundle the add-ons already in use
  (Torrentio, opensubs, and the rest of the current set) for every user. This
  reverses §9 of the product plan's "Do not bundle … configured manifests" for
  *public* manifests only, and the `D-0NN` entry must say so.
- **The bare, unconfigured public manifest is what gets bundled** — never the
  owner's own configured URL. A bundled URL must not contain a debrid key, a
  private-tracker passphrase, an OpenSubtitles-style API key, or any other
  credential: a desktop binary is trivially unpacked, so a key shipped in it is
  a published key, and every user's traffic would bill to that account.
- Traffic accounting is per user, not pooled: each install calls the add-on
  from its own IP, so nothing consumes the owner's quota and no rate limit is
  shared. Torrentio is stateless.
- Operational consequence to accept: one bundled default means one breakage
  path. If the default manifest moves or dies, every install degrades at once
  and the fix ships as an app update. Which is why the override path below must
  keep working.

## 13. Security and privacy deltas

Everything here is an intentional, documented change; nothing else moves.

1. **Second engine port** in the player URL predicate (Option A, §10). Same
   host class, same 40-hex/idx path shape, same rejection of `/settings`,
   `stats.json`, `proxy/`, userinfo and `::1`.
2. **Durable store** under `$XDG_DATA_HOME`, mode `0700` directory / `0600`
   files, owned by the app, never exposed to the WebView, never a caller-chosen
   path.
3. **Descriptor persistence** (infohash + trackers + optional `.torrent` bytes)
   in the manifest. Redacted from logs exactly like playback URLs; never sent
   to Locadora services.
4. **Second native allowlist surface**: `GET /<hash>/remove`,
   `/<hash>/<idx>/stats.json`, `/<hash>/create` on the tape port. Params
   validated (`^[0-9a-f]{40}$`, bounded idx), no caller-supplied URL.
5. Unchanged: deny-by-default IPC, no secrets in artifacts, exact CORS origins,
   playback never mutating rentals, TMDB-image-only artwork boundary.

## 14. Cost on this machine

Measured, not estimated. On the owner's laptop today: `/home` has **19 GB
free of 191 GB (90% used)** and `/` has 4.3 GB free; 19 GiB RAM with ~11 GiB
available. The disk number is the binding constraint, not RAM.

- **Default active limit of 3 (D-020) × 1.5 GB ≈ 4.5 GB** — comfortable inside
  the measured free space, and inside the 6 GB default ceiling (§20).
- **The default ceiling is 6 GB** (owner, 2026-10-19): roughly 32% of the free
  space measured on this machine, which holds four 1.5 GB tapes and refuses the
  fifth rather than eating the disk. The user can raise it; `0` removes it and
  leaves only the free-space reserve as a guard.
- **The D-020 maximum of 10 ≈ 15 GB — not viable on this disk** (79% of what is
  free). The store must therefore refuse admission by measured free space, not
  by rental count, and say so in the dashboard. Rentals are still governed by
  the server-side limit; only the *download* is refused.
- RAM: engine B's `STREMIO_MEM_LIMIT` (suggest 256 MiB) plus anacrolix overhead;
  measure before pinning. Engine A is untouched at 512 MiB. The Box has
  headroom here, so RAM is not the risk — disk is.
- CPU: one download at a time keeps hash-checking and peer churn bounded; the
  zero-copy decode work from D-027/D-029 is unaffected.
- Upload: seeding consumes upstream on a connection this project deliberately
  tunes for weakness (D-030). On Brazilian residential links upstream is often
  a small fraction of downstream, which is why the cap is a fraction of measured
  capacity (§2.1) rather than a fixed value.

## 15. Failure modes to design for, not discover

| failure | required behaviour |
|---|---|
| disk fills mid-download | stop, delete the partial dir, job `failed: no space`, rental untouched |
| tape engine dies | stream path keeps working; jobs pause; B is restarted with bounded backoff |
| app killed mid-download | nothing corrupt: pieces are engine-managed; resume re-creates and re-drains |
| tape-store.json corrupt | treat as empty for the manifest, keep directories, surface `unverified`; never mass-delete |
| source gone / dead swarm | job `failed`, tape stays stream-only; next `Assistir` may retry once |
| rental returned while watching | playback continues to end of session; file removed after the player closes, not under it |
| user lowers rental limit below active count | D-020 already says existing rentals stay; so do their tapes |
| two app instances | existing fail-closed port rule already prevents it; B must follow the same rule |

## 16. Test plan

Pure modules first (this repo's stated preference), no UI in the tests:

- queue: FIFO ordering, one active, admission refusal on size, retry-once
  semantics, cancellation on return;
- manifest: atomic write/read, corrupt-file recovery, orphan reconciliation,
  version bump behaviour;
- source choice: a downloaded job's chosen candidate equals what the existing
  Quick Watch evaluator returns for the same fixture set (this is the guard
  against a second ranking implementation drifting);
- playback switch: job state → chosen source, table-driven, including
  `unverified` and `failed`;
- URL policy: the second port is accepted, every currently rejected shape stays
  rejected (extend `stremio_service_stream_url` tests, `player.rs:854-880`);
- redaction: descriptor in an error path must not print trackers verbatim.

Contract tests against a real engine B, in-process, no network reliance:
`/create` → drain → `stats.json` shows `isSeeder` and `uploaded` → `remove`
deletes the directory.

Rust side: engine role/supervisor tests (B never wipes its root on drop, ports
are distinct, fail-closed on conflict). The mutation-check habit applies: make
B wipe its root and watch the test fail.

## 17. Acceptance criteria (owner-eyeballed, not machine-claimed)

1. Rent a tape with no add-on configuration on a fresh profile → it plays.
2. Rent a tape → it appears as downloading, progress advances, it completes.
3. Watch it → seeks are instant and the source is the finished copy.
4. `stats.json` for that tape shows uploads while it is rented and not being
   watched.
5. Return it → the file disappears and uploads stop.
6. Restart the app with a tape retained → it seeds again with no user action.
7. `Assistir` a title you have not rented → identical to today (RAM, nothing on
   disk afterwards).
8. Store directory size after returning everything → back to settings/certs
   only.

## 18. Decisions — all settled (owner, 2026-10-19)

1. Finished-copy playback: **Option A**, the tape engine's URL (§10).
2. Peer port: **pinned**, 6881-class, configurable in settings.
3. Disk budget: **unlimited in the engine**; the app owns admission, bounded by
   the smaller of the user's GB ceiling and free space minus a 2 GiB reserve.
4. Upload cap: **~40% of measured upstream by default**, unlimited as an opt-in.
5. Ratio: **unlimited while rented**, optional cap available.
6. Bundled public add-ons for every user, bare manifests only (§12).
7. Seeding window: **while Locadora is open** (§11).
8. Disk: **6 GB default** for rentals, user-configurable, with `0` meaning no
   ceiling (§20).
9. Tape count: capped by the **rental limit by default** (D-020), with an
   optional independent cap that can never exceed it (§20).
10. A **master switch** to not download or keep rented tapes at all, default on
    (§23).

All ten are recorded in one `docs/DECISIONS.md` entry (`D-0NN`) when the
milestone starts, together with the standing weak-connection constraint (§2.1).

## 19. Shape of the Codex brief

One brief per part (§21), never two runs against this repository at once.

- Read order: `AGENTS.md` → `WILLS_LOCADORA_PLAYER_PLAN.md` →
  `IMPLEMENTATION_PROGRESS.md` → `docs/DECISIONS.md` → this document.
- The owner's priority change, quoted, and the `D-0NN` entry to record.
- Hard constraints restated: web repo read-only; the `Assistir` path stays
  byte-for-byte; no new dependency without saying so; no push, no history
  rewrite, no browser/GUI; English code, PT-BR user copy.
- The engine facts from §4 restated so the run does not re-derive them wrongly
  (process-wide storage backend, no start-up resume, `remove` deletes the dir).
- Frozen contract: engine B's port, its `APP_PATH`, the manifest shape, the
  queue states.
- Proof block: `npm run check` tail, cargo tests and clippy when Rust is
  touched, `git diff --stat`, the mutation-check evidence, and an explicit
  statement of every choice this document left open.

## 20. Frozen implementation contract

These are the names, ports and shapes the parts must use. A part that needs to
change one of them stops and reports instead of improvising.

**Processes and ports**

| | stream engine (A) | tape engine (B) |
|---|---|---|
| loopback port | 11471, unchanged | **11472**, fixed, reserved fail-closed |
| `APP_PATH` | ephemeral session dir | `$XDG_DATA_HOME/com.illanrego.willslocadora/tape-store` |
| `STREMIO_MEMORY_CACHE_SIZE` | `268435456` | unset → `0` → disk |
| `STREMIO_TORRENT_IDLE_TIMEOUT` | `30` | `0` |
| `STREMIO_MAX_SEED_RATIO` | unset | `0` (unlimited, §18) |
| `BT_LISTEN_PORT` | unset (OS) | user setting, default `6881` |
| `STREMIO_DISABLE_WEBTORRENT` | `1` | `1` |
| `STREMIO_MEM_LIMIT` | `536870912` | start at `268435456`, measure |
| teardown | `remove_dir_all(session)` | never delete the store |

B starts lazily on the first rented tape, is stopped only by app exit, and sets
`cacheSize = null` plus `seedingEnabled = true` through `POST /settings` at
startup. `seedingEnabled` flips to `false` while the RAM path plays (§11).

**Storage**

- Root: `$XDG_DATA_HOME/com.illanrego.willslocadora/tape-store`, mode `0700`;
  engine settings `tape-store/server-settings.json`; pieces under
  `tape-store/<infohash>/`.
- Manifest: `tape-store.json` v1, atomic write (tmp → fsync → rename), fields as
  §7, plus `torrentBytesB64` when the stream supplied raw `.torrent` bytes.
- Metainfo rule: persist `torrentBytesB64` when available (the engine's
  `/create?from=` accepts it); otherwise persist `infoHash` + trackers and
  re-create from DHT at launch. A tape whose metainfo cannot be re-resolved
  becomes `unverified`, is never assumed playable, and never blocks the app.

**Native surface (new, deny-by-default, allowlisted)**

- `tape_engine_ensure()` → `{ url }`, must equal the fixed 11472 origin.
- `tape_engine_request(url, method, body)` — method limited to GET/POST on the
  fixed origin, path limited to
  `^/[0-9a-f]{40}(/\d{1,4})?(/(stats\.json|create|remove))?$`, body bounded.
- `tape_store_read()`, `tape_store_write(manifest)` (bounded, validated),
  `tape_store_clear()`.
- Player URL policy accepts `http://127.0.0.1:11472/<40-hex>/<idx>` with exactly
  the rejections the 11471 shape has (`/settings`, `stats.json`, `proxy/`,
  userinfo, other hosts, other ports). No filesystem path is ever accepted.

**Queue states**

`queued → resolving → downloading → ready → seeding`, plus `failed`,
`returned`, `unverified`. The player reads a snapshot; it never writes a job.

**Settings keys (localStorage, local only)**

| key | default | meaning |
|---|---|---|
| `locadora.tapes.enabled` | `true` | master switch: download and keep rented tapes at all |
| `locadora.tapes.maxGb` | `6` | what Locadora may use on disk for tapes; `0` = no ceiling |
| `locadora.tapes.maxCount` | `0` = follow the rental limit | how many tapes may be kept at once; never above the rental limit |
| `locadora.tapes.upstreamMbps` | `0` = unknown | the user's declared upstream, used for the upload cap |
| `locadora.tapes.uploadShare` | `0.4` | fraction of upstream used for seeding; `1` = unlimited |
| `locadora.tapes.ratio` | `0` = unlimited | ratio after which a tape stops uploading (it is kept) |
| `locadora.tapes.peerPort` | `6881` | pinned peer port; `0` = random each start |

## 21. Parts and delegation

One part per run, sequential, one writer per repository. Model tiers follow the
owner's rule: `gpt-6-astra` high only where a mistake is expensive, otherwise
`gpt-5.6-sol` (high, or medium for a contained change).

| part | scope | tier |
|---|---|---|
| P1 | **native tape surface**: engine role split (11472, durable store, lazy start, never wipe on drop, fail-closed), the allowlisted `tape_engine_request` bridge, and the `tape_store_*` file I/O — so P2 can be pure TypeScript | astra high |
| P2 | manifest + admission + queue: descriptor persistence, GB ceiling, min(cap, free−2 GiB), drain-to-complete, progress, retry-once, cancellation | sol high |
| P3 | playback switch: 11472 in the player predicate, ready→local copy, otherwise RAM path untouched, rejection tests kept | sol high |
| P4 | seeding window and caps: `seedingEnabled` two-state machine, queue pause during a RAM stream, upload share, ratio, pinned peer port, settings surface | sol high |
| P5 | tape dashboard: per-tape rows, uploaded per tape and per session, store total vs cap, the plain-language line, Carteirinha placement | sol high |
| P6 | bundled stream and subtitle defaults for new profiles (bare public manifests, empty-only seeding, override preserved) | sol medium |

P1 first because everything else talks to B. P3 before P4 because you cannot
serve a tape the player cannot open. P5 last but one so the numbers it displays
exist. P6 is independent and can move anywhere.

Every brief carries the standard proof block, and the milestone records the
`D-0NN` entry from §18 before P1 starts.

## 22. One mechanism still genuinely open

The upload cap is "~40% of measured upstream" (§18, §11), and *measured* has no
definition yet. Two honest options:

1. **The user declares it** — one field in settings ("minha internet envia X
   Mbps"), default derived from a conservative value. Predictable, explainable,
   one screen, no guessing. Wrong only if the user lies or does not know.
2. **The app learns it** — observe achieved upload throughput across sessions and
   cap at a multiple of the observed peak. Self-tuning, but it takes sessions to
   converge and it will be wrong on a bad night.

Recommendation: **declare it**, with the app's own observed peak shown beside the
field so the number is grounded rather than a guess. P4 decides this before it
starts; nothing in P1–P3 depends on it.

## 23. Defaults borrowed from desktop torrent clients (verified 2026-10-19)

Read from the clients' own sources, not from memory: qBittorrent
`src/base/bittorrent/sessionimpl.cpp` (master) and Transmission
`docs/Editing-Configuration-Files.md` (main). Deluge, µTorrent/BitTorrent
Classic and MiTorrent are closed or were not verifiable from source in this
pass — do not quote numbers for them.

| client | upload limit | ratio limit | stops seeding | peer port |
|---|---|---|---|---|
| qBittorrent | `GlobalUPSpeedLimit` = `0` → unlimited | `GlobalMaxRatio` = `-1` → unlimited | never by default (inactive-seed limit off) | `Port` = `-1` → **random each start** |
| Transmission | `speed_limit_up` 100 kB/s but `speed_limit_up_enabled` = false → unlimited | `seed_ratio_limit` = 2.0 but `seed_ratio_limited` = false → **not enforced** | seeds indefinitely | `peer-port-random-enabled` = false → fixed port |
| µTorrent / BitTorrent Classic | not verified | not verified | not verified | not verified |

**The pattern worth copying:** the popular clients ship unlimited upload,
unlimited ratio, and seed until you remove the torrent. Their limits exist and
are off.

That matters for our design: "seed while Locadora is open" is not a Locadora
invention, it is exactly the client model — a client seeds while it runs and
stops when you close it. We match the clients on the two things that define the
behaviour (ratio, when serving stops) and differ only where our context does.

**Where we deliberately differ, and why**

| we do | clients | reason |
|---|---|---|
| upload capped at ~40% of declared upstream | unlimited | the user never chose a torrent client; §2.1 assumes a weak link |
| pinned port, `6881` default, "random" still an option | qBittorrent random, Transmission fixed | give-back for IPv4 peers, with the choice left to the user |
| a 6 GB space ceiling and a tape-count cap | no such concept | we keep rentals, not a library; disk is the scarce resource on the target machine |
| a master switch to not keep tapes | not applicable | an ethical default is still a default |

**What is interesting for the user to change** (the whole surface, §20):
whether the feature is on at all; the GB ceiling; how many tapes are kept; the
declared upstream and the share of it we may use; the ratio; and the peer port.
Everything else stays an internal constant — a torrent client's full option
matrix is not our product, and every knob we expose is one more thing that can
be set wrong.

**Three different numbers, kept distinct on purpose:** the server-side rental
limit (D-020), the local tape-count cap (defaults to the rental limit, so most
users never see it), and the GB ceiling (6 GB). The rental limit decides what
you may borrow; the other two decide what fits on the disk.
