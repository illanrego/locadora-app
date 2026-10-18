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
- **Disk admission**: before enqueuing, compare `sizeBytes` (from the chosen
  candidate, which Quick Watch already normalised) against free space minus a
  reserve (suggest 2 GiB). Insufficient space → job refused with a message; the
  rental still exists, the tape simply stays stream-only.
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

- Upload is on for engine B (`seedingEnabled=true`), unlimited ratio by
  default, cap optional via `STREMIO_MAX_SEED_RATIO` without losing retention.
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
- The peer port question (§18) decides whether we are also reachable inbound.
  Outbound-only still seeds, but at a fraction of the give-back rate and mostly
  to peers we dialled. Because serving is bounded to app sessions, a pinned
  port is reachable only inside those sessions — the exposure window and the
  serving window are the same window.
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
  the measured free space.
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

## 18. Open decisions for the owner

Each has a recommendation; none is implemented until answered.

1. **Finished-copy playback: decided — Option A (§10).** Recorded 2026-10-18.
2. **Peer port: pinned or OS-assigned.** Still open. Mechanics verified since
   the first draft: the engine reads `BT_LISTEN_PORT` (`app.go:111`, `0 =
   random`), ports are settable without touching the binary; the bundled
   library leaves `NoDefaultPortForwarding` false, so UPnP/NAT-PMP mapping is
   attempted automatically; and this machine has global IPv6 on `wlp3s0`
   (`2804:14c:5be0:83ba::/64`), which the engine's own `Seed` comment names as
   its inbound path ("uses IPv6 inbound") — so reachability here does not
   depend on the port at all. Pinning therefore buys a predictable port for
   IPv4-only peers, not reachability. Recommend pinned (`6881`-class, configurable)
   for give-back, with the disclosure wording carrying the honesty.
3. **Disk budget: app admission control or engine `cacheSize`.** The engine
   evicts least-recently-accessed torrents once over budget, and it has no
   per-torrent pin — so a rented tape nobody opened is a prime eviction target.
   Recommend `cacheSize = null` (unlimited) for engine B and let the app's own
   admission control be the only limit, so the engine never evicts a rental.
4. **Upload cap.** Recommend a visible setting with a sane default cap on this
   connection (e.g. 30–50% of upstream), unlimited being opt-in, because D-030
   already tunes the whole player for a weak link.
5. **Ratio policy.** Recommend unlimited while rented (the point is giving
   back) with an optional cap in settings.

## 19. Shape of the Codex brief

When approved, the brief is one job (one Codex run per repository):

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
