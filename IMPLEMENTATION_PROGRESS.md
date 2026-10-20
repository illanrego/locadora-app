# Implementation progress

Last updated: 2026-10-20
Current milestone: D-034 rented tapes P8 — restart hydration and derived seeding state
Status: P8 implemented and automated checks green; owner engine/network acceptance for P5–P8 pending

## Resume checkpoint

2026-10-20 D-034 rented tapes P8 restart hydration and derived seeding state:
- `src/rentals/tapeHydration.ts` (new, pure) is the once-per-session startup
  step (§8 "app restart", §9 retry-once). It samples `locadora.tapes.enabled`
  before anything else and returns without a read when it is off; reads the
  manifest and returns without starting engine B when it is empty; then calls
  `tape_engine_ensure()` once and POSTs `/<hash>/create` for every `ready` /
  `seeding` row through the existing allowlisted bridge, reusing the pipeline's
  own `tapeCreateBody` (`torrent.infoHash`, `guessFileIdx: false`,
  `peerSearch.sources` = `dht:<hash>` + the row's trackers). That registration is
  what makes a retained file servable from disk and seeder-able again.
- `queued` / `resolving` / `downloading` rows are reset to `queued` (their
  attempt died with the old process) and handed to the one runtime queue, which
  is then pumped; `failed` rows follow the same reset, which is §9's one retry
  per launch, and the queue's own budget makes a second failure in that launch
  terminal (`MAX_TAPE_ATTEMPTS_PER_SESSION = 2`). A row already `queued` is
  re-queued without a write. A `/<hash>/create` answered 408/504 means metainfo
  cannot be re-resolved: the row becomes `unverified`, is never deleted and never
  retried in a loop, and playback keeps falling back to the RAM path. Any other
  non-2xx leaves the row `ready` (the file is still on disk) and counts as
  `refused`.
- At most one manifest write per run, taken only when a row actually changed; a
  write failure is reported and does not stop the queue, because every job start
  persists its own state.
- `src/App.tsx` runs it once the shelf settles (ready *or* failed): the app is
  ready, never before. `hydrateRetainedTapes()` in
  `src/rentals/rentalTapePipeline.ts` wires the singleton; the queue is reached
  lazily, so a session with only `ready` rows never builds it (and never
  subscribes to native progress), and an empty manifest touches nothing.
- `src/rentals/tapeDashboard.ts` derives the sharing state: `tapePresentedState`
  presents a `ready` row as `seeding` ("compartilhando"/"sharing") when the stats
  reply says `isSeeder` or reports a non-zero `uploaded`, and as `ready`
  ("pronta") otherwise. `readTapeStats` parses both from the one bounded
  `GET .../<fileIdx>/stats.json` the dashboard already made per tape, and accepts
  `isSeeder` only as a top-level boolean (the pinned engine's `wires[].isSeeder`
  describes the remote peer). Nothing is polled or written: no timer, no
  manifest churn, and the manifest's `seeding` value stays reserved for a future
  engine that emits a seeding event. `buildTapeDashboard` now takes that reading
  map; `readTapeUploaded` stays as the number-only accessor.
- Choices the brief left open: (a) the once-guard is spent even when the switch
  is off, so a switch turned on mid-session hydrates at the next launch instead
  of starting engine B minutes later, possibly during a RAM playback the P4
  window had silenced; (b) 408/504 is the whole "metainfo unresolvable" set — the
  engine answers 504 when `Engine.Ready` times out — while a 5xx leaves the row
  `ready` rather than understating a file that is still there; (c) a bridge
  failure mid-run stops the registration pass and writes nothing, so a dead
  engine is never hammered once per row; (d) the run happens after the shelf
  settles in either direction, so a catalogue outage cannot also kill seeding;
  (e) the only log line is one `console.warn` per problem, carrying no infohash,
  magnet, tracker or path; (f) registration is sequential and finishes before the
  queue is pumped, keeping §2.1's one-network-activity rule, at the cost of a
  mid-download tape waiting for each unresolvable `ready` row to time out.
- Exact validation commands/results:
  - `npx tsc -b --pretty false`: exit 0.
  - `npx vitest run test/tapeHydration.test.ts`: 1 file, 15 tests passed.
  - `npx vitest run test/tapeDashboard.test.tsx`: 1 file, 15 tests passed.
  - `npm run check`: exit 0; `tsc -b` clean; Test Files 56 passed (56), Tests 443
    passed (443) — baseline 55/423, so one new file and +20 tests; Vite built 205
    modules with the existing chunk advisory only.
- Mutation evidence, both restored before commit: (1) `SERVABLE_STATES` reduced to
  `['seeding']` so hydration skipped `ready` rows — `npx vitest run
  test/tapeHydration.test.ts` exited 1 (5 failed, 10 passed), starting with
  "re-attaches every ready and seeding tape exactly once..." (`registered` 3 → 1);
  restoring gave 15 passed. (2) `tapePresentedState` reduced to `return state;`
  so the dashboard ignored the seeder signal — `npx vitest run
  test/tapeDashboard.test.tsx` exited 1 (4 failed, 11 passed), the first row
  reading `pronta` instead of `compartilhando`; restoring gave 15 passed.
- No browser/GUI automation and no real download, seeding or playback was
  performed; no manual visual verification. No push, no history rewrite, no
  dependency, no timer, no Rust change, and no manifest, queue, admission or
  settings contract change.
- **Next task:** owner acceptance run for P5–P8 on a real engine and network:
  rent two movies, let one finish and leave the other mid-download, quit the app
  and reopen it; confirm the finished tape is re-attached (already downloaded
  bytes are not fetched again), that it plays from disk, that the mid-download
  tape resumes, and that the dashboard row for the finished tape reads
  `compartilhando` once the engine reports uploads. §22 (how "measured upstream"
  is defined for the P4 upload cap) remains the only open mechanism.

2026-10-19 D-034 rented tapes P7 bundled stream and subtitle defaults (D-035):
- `src/platform/nativeBridge.ts` replaces the single metadata default with an
  ordered table `DEFAULT_MEDIA_ADDONS`: `meta` (Cinemeta, unchanged), `stream`
  (`https://torrentio.strem.fun/manifest.json`), `subtitles`
  (`https://opensubtitles-v3.strem.io/manifest.json`). All three are bare public
  manifests with no account, key, query string or debrid configuration.
- `readMediaConfiguration` walks that table once per read. For each resource it
  skips the resource when its seed flag is recorded, records the flag and moves
  on when a configured add-on already declares it, and otherwise appends the
  default through the existing `media_configuration_add` command and records
  that one flag. Defaults are appended after the user's add-ons in the fixed
  metadata → stream → subtitles order; nothing is reordered, replaced or
  removed. The command returns the updated list, so each later decision sees
  the result of the earlier ones.
- Seed flags are now per resource:
  `locadora:default-media-seed-v1:meta|stream|subtitles`, plus a session set for
  the case where WebView local storage is unavailable. Seeding one default no
  longer marks the other two as decided.
- Deliberate removal stays respected: `removeMediaConfiguration` snapshots the
  configuration first, removes the add-on, then records the resources that
  add-on declared, so only that decision is settled. If the snapshot fails the
  removal still happens and all three are recorded — an explicit removal must
  never be undone by a later read. `disconnectMediaConfiguration` still records
  all three. Add and the read-only Stremio import still record nothing, so an
  imported stream-only collection still receives the metadata and subtitle
  defaults it cannot answer.
- Choices the brief left open: (a) a resource the configuration already covers
  is recorded without an add, so a later read cannot append a default behind the
  user's back even if the add-on disappears by a path other than
  `removeMediaConfiguration`; (b) the superseded single key
  `locadora:default-media-seed-v1` is no longer read — it cannot say which
  resource it settled, so an empty configuration is seeded again rather than
  left without metadata, streams or subtitles (a user on the old build who
  removed an add-on may therefore see Cinemeta reappear once); (c) a failed add
  records nothing and is not retried inside the same read, so the next read may
  attempt it once more — bounded per read, never a loop; (d) the seeding order
  is metadata, streams, subtitles, chosen because a series needs metadata before
  a stream or subtitle request makes sense; (e) no settings surface was added.
- Exact validation commands/results:
  - `npx tsc -b`: exit 0.
  - `npx vitest run test/mediaConfigurationDefault.test.ts`: 1 file, 11 tests
    passed.
  - `npm run check`: exit 0; `tsc -b` clean; Test Files 55 passed (55), Tests
    423 passed (423) — baseline 55/416, so +7 tests in the existing file; Vite
    built 204 modules with the existing chunk advisory only.
- Mutation evidence, restored before commit: made `configurationCovers` return
  false for `stream`, so the stream default ignored an existing stream add-on.
  `npx vitest run test/mediaConfigurationDefault.test.ts` exited 1 (3 failed, 8
  passed): "adds only the resources a stream-only configuration lacks, after
  it", "adds nothing when the configuration already answers all three
  resources", and the import/disconnect case. After restoring the predicate the
  same command exited 0 (11 passed).
- No browser/GUI automation, no real add-on request, no manual visual or
  playback verification was performed. No push, no history rewrite, no
  dependency, no Rust change.
- **Next task:** owner acceptance run for P5–P7 on a real engine and network:
  start from an empty profile and confirm the settings drawer lists Cinemeta,
  Torrentio and OpenSubtitles v3 in that order; add a personal Torrentio and
  confirm no second stream add-on appears; remove one default and confirm it
  stays gone after a restart while the others remain; then rent a movie and
  check the P6 dashboard row, its uploaded figure and the four `locadora.tapes.*`
  controls. §22 (how "measured upstream" is defined for the P4 upload cap)
  remains the only open mechanism.

2026-10-19 D-034 rented tapes P6 tape dashboard and settings surface:
- `src/components/TapeDashboard.tsx` (new) is the read-only dashboard inside
  the Carteirinha, placed after the active rentals and before the collapsed
  history. It renders one row per **local-manifest** tape with title, readable
  state, size on disk, a best-effort `uploaded` figure and last played, then the
  total-versus-ceiling line and the plain-language disclosure. It renders
  nothing at all for an empty manifest, an unreadable manifest, or while the
  read is in flight. No return, delete, retry, pause or reprioritise control
  exists; the only button is "inspect this title", and only when the tape's
  `contentId` matches a title the panel already knows (`knownTitles`, the same
  canonical keys), so no title is invented to make a button.
- `src/rentals/tapeDashboard.ts` (new) is the pure half: manifest → rows, the
  state-word table, byte/date formatting, the total sentence, and the bounded
  `readTapeUploaded` parser. A missing uploaded figure is `null` and paints as
  "—"; only a real `0` prints as `0 MB`.
- Uploaded is read per tape through the existing allowlisted bridge with
  `GET /<hash>/<fileIdx>/stats.json` (`requestTapeEngine`, never `ensure`). A
  stopped engine, a non-200 answer, a malformed or unbounded body, or a bridge
  rejection becomes a dash per row and never an error surface. No session-total
  column was added: the P6 brief's columns are the four named ones and a
  session-scoped sum has no committed source yet.
- `src/components/TapeSettingsGroup.tsx` (new) is the four `locadora.tapes.*`
  controls as their own `<fieldset>` in the existing settings drawer:
  `enabled` (checkbox, writes immediately), `maxGb`, `ratio`, `peerPort`. The
  three numeric fields keep typed draft text and commit on blur or Enter, then
  read the accepted value back from `tapeSettings`; empty or invalid text
  reverts to the accepted value. Ratio and peer port carry "next start" hints
  plus a group note; no restart path was built.
- `MemberPanel.tsx` gains one mount line and `TapeDashboard` import;
  `App.tsx` gains one group and import; `styles.css` gains the table and group
  styles. The pipeline, queue, manifest format, playback switch, seeding
  window, player, engine A/B and every Rust file are untouched. No dependency.
- Choices the brief left open: state comes from the manifest rather than the
  runtime queue snapshot, because the dashboard must show `ready`/`seeding`/
  `failed`/`returned` rows the queue is not currently draining; `resolving`
  reads as "verificando/checking" and `unverified` as "não verificada/
  unverified"; a `returned` row is shown if a manifest still has one (a normal
  return already deletes it); the ceiling is read once at mount from
  `readTapeSettings().maxGb` and `0` prints "sem limite de espaço / no storage
  limit"; the total is shown as-is even when above the ceiling (the dashboard
  never deletes); the disclosure sentence is a product line, not a policy link.
- Exact validation commands/results:
  - `npx tsc -b`: exit 0.
  - `npx vitest run test/tapeDashboard.test.tsx
    test/tapeSettingsControls.test.tsx test/memberPanel.test.tsx`: 3 files,
    29 tests passed.
  - `npm run check`: exit 0; `tsc -b` clean; Test Files 55 passed (55), Tests
    416 passed (416) — baseline was 53/399, so +2 files and +17 tests; Vite
    built 204 modules with the existing chunk advisory only.
- Mutation evidence, restored before commit: made `buildTapeDashboard` append a
  tape that is not in the manifest. `npx vitest run
  test/tapeDashboard.test.tsx` exited 1 (4 failed, 6 passed) at the row-count,
  dash-count and total assertions; after restoring the file the same command
  exited 0 (10 passed).
- No browser/GUI automation, real torrent, real engine, manual visual or
  playback verification was performed. No push, no history rewrite.
- **Next task:** P7 — bundled stream and subtitle defaults for new profiles
  (`docs/RENTED_TAPE_DOWNLOAD_AND_SEEDING_PLAN.md` §12): ship bare public
  Stremio-compatible manifests seeded only into an empty media configuration,
  keep D-003/D-011 overrides, default subtitles to the key-less `opensubs`
  add-on, and prove an existing non-empty configuration is never overwritten.
  Owner acceptance of P5/P6 still needs a real engine run: rent a movie, watch
  the dashboard row and its uploaded figure appear, adjust the four controls,
  then return the tape and confirm the row disappears.

2026-10-19 D-034 rented tapes P5 enqueue wiring (movies):
- `src/rentals/rentalTapePipeline.ts` (new) is the missing link between the
  rental service and the tape pipeline. It owns the single runtime
  `TapeQueue` (built by `createTapeQueue` with the composite driver), the
  manifest transitions and the two hook entry points. The direction is strictly
  rental → tape: nothing in the module imports a rental mutation command.
- A confirmed rental is read from the create response
  (`{ rental: { id, items } }`) through the existing
  `normalizeMemberState`, so item IDs and canonical keys use one normalizer.
  Every **movie** item is offered; **series items are skipped** with
  `series-out-of-scope` and a comment — which episode a series rental should
  download is undecided, so nothing is guessed.
- The order for one movie: `locadora.tapes.enabled` → the shipped evaluator
  (`resolveTitleMedia` = `normalizeStreams` + `selectQuickWatch` movie-v1, one
  winner, no second chooser) → `admitTape({ maxGb, freeBytes: null })` →
  manifest row via `upsertTape` + `tape_store_write` → queue enqueue →
  `tape_engine_ensure()` → `POST /<hash>/create` (body mirrors
  `ensureTorrentStream`: `torrent.infoHash`, `guessFileIdx: false`,
  `peerSearch.sources` only when trackers exist) → `tape_download_start` →
  progress events → row `ready`.
- Choices the brief left open, implemented consistently: no manifest row when
  Quick Watch has no winner, when the winner is not a torrent, or when its file
  index is unknown (a `failed` row would occupy an admission slot for a download
  that was never attempted; §9 says such a tape stays stream-only) — the typed
  attempt carries `no-qualifying-source` / `not-a-torrent` /
  `unknown-file-index`; `maxCount` is not a persisted setting (P4 note) so
  admission follows its documented rental-limit/ten-row default; `fileName` is
  the add-on display label (the normalizer folds `behaviorHints.filename` into
  `displayName`); `torrentBytesB64` is always `null` because no raw `.torrent`
  reaches TypeScript; completion leaves the row `ready` (the committed native
  driver emits no seeding signal); a return **deletes** the row per §8.
- Removal uses `GET /<hash>/remove`, not POST: the frozen native bridge
  (`tape_request_allowed`) accepts POST only on `/create` and `/settings`, and
  the native allowlist tests GET remove explicitly. No Rust file changed.
- `src/rentals/tapePlaybackWindow.ts` now pauses and resumes that one runtime
  queue (previously it built a second, driver-only queue that no producer fed).
  A RAM load therefore holds downloads back (§2.1) and a new optional
  `onNetworkAvailable` callback pumps the queue when the RAM path ends; the
  queue itself still never auto-starts.
- Hooks are exactly two and both fire-and-forget:
  `offerConfirmedRentalToTapes(rentalResponse, selected)` in
  `BasketPanel.checkout` after `createMemberRental`, and
  `releaseReturnedTape(item.id)` in `MemberPanel.returnTape` after
  `returnMemberRental`. No UI, copy, layout or rental payload changed. A media
  failure during a return is a typed reason (`engine-unavailable`,
  `remove-rejected`) and never reaches the rental error path.
- Manifest mutations (rent, progress-driven state, completion, return) are
  serialized through one chain, so a read-modify-write cannot clobber another
  row in flight. A refused admission performs no manifest write, no engine
  ensure and no download start.
- Exact validation commands/results:
  - `npx vitest run test/rentalTapePipeline.test.ts`: 1 file, 12 tests passed.
  - `npx vitest run test/rentalTapePipeline.test.ts test/memberPanel.test.tsx
    test/basketPanel.test.tsx test/tapePlaybackWindow.test.ts`: 4 files, 35
    tests passed.
  - `npm run check`: exit 0; `tsc -b` clean; Test Files 53 passed (53), Tests
    399 passed (399) — baseline was 52/386, so +1 file and +13 tests; Vite built
    201 modules (one more than P4) with the existing chunk advisory only.
- Mutation evidence, restored before commit: gated the enqueue's master-switch
  check with `false &&`. `npx vitest run test/rentalTapePipeline.test.ts -t
  'master switch'` exited 1 (1 failed, 11 skipped) at the
  `readManifest`-not-called assertion; after restoring the file the same
  command exited 0 (1 passed, 11 skipped).
- Scope proof: the diff touches `BasketPanel.tsx` (one hook line + import),
  `MemberPanel.tsx` (one hook line + import), `tapePlaybackWindow.ts` (shared
  queue + `onNetworkAvailable`), the two component tests, and the new module
  and test. `quickWatch.ts`, `normalization.ts`, `resolutionService.ts`,
  `tapeQueue.ts`, `tapeManifest.ts`, `tapeAdmission.ts`, `tapeSettings.ts`,
  `platform/tape.ts`, `WatchFlow`, `useStremioVideo`, `tapePlayback`, the
  series code, the resume store and every Rust file are unchanged.
- No browser/GUI automation, real torrent, real download, real seeding, manual
  visual or playback verification was performed. No dependency was added. No
  push, no history rewrite.
- **Next task:** P6 — the tape dashboard and settings surface from
  `docs/RENTED_TAPE_DOWNLOAD_AND_SEEDING_PLAN.md` §11.1/§20: per-tape rows
  (state, size, last played, store total vs cap) read from
  `readTapeManifest()` plus the new runtime queue snapshot
  (`rentalTapePipeline().queue.snapshot()`), and the four persisted
  `locadora.tapes.*` controls, without inventing the unavailable numeric upload
  limiter. Owner acceptance of P5 still requires a real engine run: rent a
  movie, watch the row go queued → resolving → downloading → ready, then return
  it and confirm `GET /<hash>/remove` and the row deletion.

2026-10-19 D-034 rented tapes P4 seeding window and spawn-time caps:
- Implementation commit: `da55660` (`Pause tape seeding during RAM playback`).
  Per the brief, this ledger was updated AFTER the one implementation commit
  and is the only uncommitted file. No push.
- `src/rentals/tapePlaybackWindow.ts` owns the two-state scheduling rule. Its
  raw-spelling predicate recognizes only the strict finished-copy URL on 11472.
  A non-tape load is the RAM path: it pauses the queue and requests
  `POST /settings` with `{"seedingEnabled":false}` once. End, close, load error,
  native failure and a switch to a finished tape resume the queue and request
  `{"seedingEnabled":true}` once. Repeated lifecycle notifications are
  idempotent. Engine-off readiness returns normally with no settings POST and
  no user-visible error. The shell transport only reports load/stop/end/error
  lifecycle; stream selection, loading and player commands are unchanged.
- `src/rentals/tapeQueue.ts` now owns a pause bit. A paused queue cannot start a
  job. Pausing an active drain first frees its queue slot, returns the job to
  FIFO as `queued`, rolls back the intentionally interrupted attempt, and calls
  driver cancellation. Its eventual cancelled rejection cannot fail either the
  queued job or a newer resumed run. Resume makes `startNext()` available again;
  it deliberately does not auto-pump, preserving P2b's explicit-start rule.
  A queue constructed with the master switch off cannot be resumed or run.
- `src/rentals/tapeSettings.ts` is the requested local-only four-key typed
  store: `locadora.tapes.enabled` (default true), `maxGb` (6), `ratio` (0,
  unlimited) and `peerPort` (6881, with 0 accepted as random). Invalid values
  fall back to their safe defaults; writes persist one normalized snapshot.
  P4 chose `maxGb` as the fourth enforceable/storage key because admission
  already owns it. `maxCount` remains a typed P2b admission input pending its UI
  wiring. The frozen `upstreamMbps`/`uploadShare` values are not written because
  the pinned engine has no numeric upload limiter.
- Engine B samples `STREMIO_MAX_SEED_RATIO` and `BT_LISTEN_PORT` from those
  settings at lazy spawn. A live B remains unchanged until its next start; no
  restart path was added. The tape download command carries the same values to
  its idempotent ensure, avoiding a default-setting restart race. The master
  switch is checked before both direct B ensure and driver start, so false means
  neither command is invoked by the application.
- The tape request bridge adds only exact raw `/settings` POSTs whose JSON is a
  one-key boolean `seedingEnabled` object. GET, extra keys, non-booleans, dot-
  segment spellings, foreign origins and every existing bounded-body rejection
  remain denied. A read-only tape-engine status command allows the frontend to
  skip the POST while B is off. No URL or infohash-bearing descriptor is logged.
- **Known engine limitation:** the pinned v0.16.1 engine exposes no numeric
  upload-rate setting. `seedingEnabled=false` pins its existing limiter to one
  byte per second, but the design's approximately 40% upstream cap cannot be
  enforced today. P4 does not duty-cycle, patch the vendored binary, persist a
  decorative upload limit, or claim that the cap exists.
- Exact validation commands/results (sequential; Rust never overlapped npm):
  - `npx vitest run test/tapeSettings.test.ts test/tapeQueue.test.ts
    test/tapePlatform.test.ts test/tapePlaybackWindow.test.ts
    test/stremioShellTransport.test.ts`: 5 files, 49 tests passed.
  - `cargo test --manifest-path src-tauri/Cargo.toml`: 54 passed, 0 failed,
    2 ignored; main/doc tests 0.
  - `cargo test --manifest-path crates/native-core/Cargo.toml --
    --test-threads=1`: 24 passed, 0 failed/ignored; doc tests 0.
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --
    -D warnings`: exit 0.
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and
    `cargo fmt --manifest-path crates/native-core/Cargo.toml --check`: exit 0.
  - `npm run check`: exit 0; TypeScript passed; Test Files 52 passed (52),
    Tests 386 passed (386); Vite built 200 modules, existing chunk advisory only.
  - `npm run tauri -- build --no-bundle`: exit 0; verified/prepared the pinned
    engine, built 200 frontend modules and refreshed
    `src-tauri/target/release/wills-locadora-player`.
  - `git diff --check` and `git diff --cached --check`: exit 0.
- Mutation evidence, restored before commit: changed the player-state branch
  from `next !== 'ram'` to `next === 'ram'`. `npx vitest run
  test/tapePlaybackWindow.test.ts -t 'posts false once'` exited 1: 3 failed,
  3 skipped, with the expected false/true sequence missing. After restoration,
  the same command exited 0: 3 passed, 3 skipped.
- Scope proof: `git diff --exit-code HEAD -- crates/native-core
  src/components/WatchFlow.tsx src/media/useStremioVideo.ts
  src/media/tapePlayback.ts src/platform/stremioService.ts
  src-tauri/src/commands.rs` exited 0 before commit. The 11471 constants, env,
  `Engine` lifecycle/ephemeral teardown, readiness logic, request validator and
  request command are unchanged. Native player policy remains 24/24 green.
  The implementation diff was 13 files, 711 insertions and 22 deletions.
- No browser/GUI automation, real torrent, real seeding, manual visual or
  playback verification was performed. No dependency, UI, manifest format,
  rental state, return state, collection, review or donation path changed.
- **Next task:** P5 under the owner's next brief: wire the canonical tape queue
  and manifest transitions into the tape dashboard, showing per-tape/session
  upload and store-vs-cap data without inventing the unavailable numeric upload
  limiter; preserve P4's lifecycle coordinator and explicit-start queue rule.

2026-10-19 D-034 rented tapes P3 playback switch:
- Implementation commit: `c8a74b0` (`Play ready rental tapes through the persistent
  engine`). Per the brief's ordering, this ledger was updated AFTER the one
  implementation commit and remains the only uncommitted file. No push.
- `src/media/tapePlayback.ts` reads and validates a manifest snapshot before
  the existing WatchFlow stream-resolution work. Only the exact content's
  `ready`/`seeding` row qualifies. After `ensureTapeEngine()` succeeds it returns
  a direct URL candidate on fixed port 11472; no Quick Watch or add-on stream
  resolution runs for that candidate. Missing/corrupt/invalid records, failed
  lookups and engine startup failures silently return to the normal flow.
- `WatchFlow.tsx` also falls back silently if the initial direct `video.load`
  promise rejects. Closing during lookup/ensure cancels the continuation.
  External subtitle resolution retains the selected episode; tape playback
  starts before optional subtitle configuration is read. Embedded tracks keep
  using the untouched mpv/ShellVideo track path. There are no job, rental,
  seeding-setting or lastPlayedAt writes, and no new watched-marking logic.
- IMPORTANT baseline discrepancy and choice: the P3 brief described 11471 as
  already restricted to hash/index URLs. The actual baseline explicitly allowed
  proxy paths, stats.json and normalized traversal, with positive tests. To
  honor the overriding unchanged-RAM requirement, 11471's policy and tests stay
  intact (the now-allowed 11472 negative case becomes 11473). ONLY 11472 gains
  the strict raw `http://127.0.0.1:11472/<40-hex>/<digits>` predicate. It rejects
  settings, proxy, stats, traversal including encoded/normalized dot segments,
  alternate hosts/IP spellings, userinfo, other schemes/ports, query, fragment,
  empty/malformed paths and oversized URLs. No engine-A restriction was added.
- Other implementation choices left open by the brief:
  - v1's existing contentId carries the movie canonical key (`movie:tmdb:N`)
    or the exact D-031 episode video ID (`tt…:S:E`). No field/format changes.
    A series-only key is deliberately insufficient; future tape writers must
    use the episode key. A movie tape does not require an IMDb mapping.
  - The first eligible validated row in manifest order wins; validation reuses
    P2b bounds (lower-case hash, fileIdx 0..9999). Native playback accepts hex
    in either case and digit-only indexes within its existing URL length cap.
  - Ready/seeding is the existing completion authority: no extra disk/stat
    probe, torrent registration or restart repair is introduced. The owner
    still needs to verify live retained-file/restart playback. Later native
    playback events retain their existing behavior; the additional silent
    fallback covers lookup, ensure and initial load-promise rejection.
  - A finished copy autoplays even when Quick Watch is disabled. Configuration
    and subtitle failures cannot prevent its playback. The optional lookup
    precedes the unchanged normal configuration/subtitle/stream/load calls.
  - The URL candidate uses the existing direct-URL resume/subtitle-delay
    fingerprint, distinct from the RAM torrent fingerprint. No resume records
    are migrated or copied; no new persistence policy is introduced.
  - Engine B ensure uses its current defaults; peer-port/settings application,
    queue pumping, rehydration and seeding scheduling remain outside P3.
- Exact validation commands/results (sequential; Rust never overlapped npm check):
  - `npx vitest run test/watchFlow.test.tsx test/useStremioVideo.test.tsx`:
    2 files, 66 tests passed.
  - `cargo test --manifest-path src-tauri/Cargo.toml`: 52 passed, 0 failed,
    2 ignored; main/doc tests 0. Initial sandbox attempt: 42 passed, 10 failed,
    2 ignored due to blocked sockets; same command passed with socket permission.
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:
    exit 0.
  - `cargo fmt --check`, from `src-tauri/`, then from `crates/native-core/`:
    both exit 0. Formatting applied with
    `cargo fmt --manifest-path crates/native-core/Cargo.toml` before checks.
  - `cargo test --manifest-path crates/native-core/Cargo.toml -- --test-threads=1`:
    24 passed, 0 failed/ignored; doc tests 0. This separate suite is necessary
    because Tauri's suite does not execute its dependency's player-policy tests.
  - `npm run check`: exit 0; TypeScript passed; `Test Files 50 passed (50)`,
    `Tests 370 passed (370)`; Vite built 197 modules, existing chunk advisory only.
  - `npm run tauri -- build --no-bundle`: exit 0; refreshed
    `src-tauri/target/release/wills-locadora-player`. Initial sandbox extraction
    failed with `spawnSync tar EPERM`; same command succeeded with permission.
  - `git diff --check` / `git diff --cached --check`: exit 0.
- Mutation evidence, each restored before the commit:
  - Replaced the two-port predicate with `url.port() != Some(11471)`.
    `cargo test --manifest-path crates/native-core/Cargo.toml
    player::tests::tape_service_accepts_only_direct_file_urls -- --exact` exited
    101: 0 passed, 1 failed, 23 filtered, at the new `.is_ok()` assertion.
    Restored: same command exited 0, 1 passed, 23 filtered.
  - Replaced the ready/seeding condition with unconditional `true`.
    `npx vitest run test/watchFlow.test.tsx -t 'keeps the normal calls'` exited 1:
    6 failed, 7 passed, 39 skipped (52). Queued, resolving, downloading, failed,
    returned and unverified incorrectly loaded the tape URL. Restored: same
    command exited 0, 13 passed, 39 skipped (52).
- Diff proof: `git diff --exit-code HEAD -- src-tauri
  src/media/useStremioVideo.ts src/media/resolutionService.ts src/platform
  src/rentals test/tapeManifest.test.ts test/tapeAdmission.test.ts
  test/tapeQueue.test.ts test/tapePlatform.test.ts` returned 0 before commit.
  Engine A's env, teardown, bridge and ensure/registration/stall code, plus
  the driver, manifest, queue and their tests are textually unchanged. The
  WatchFlow normal branch remains in place after the optional tape branch.
- `git status --short` initially empty; staged implementation diff:
  5 files, 309 insertions, 6 deletions. Clean immediately after commit;
  final status is ` M IMPLEMENTATION_PROGRESS.md` for this requested handoff.
- Walkthrough: an episode keyed `tt…:2:3` with a ready/seeding tape loads
  its own 11472 hash/index without stream resolution. The same episode while
  queued/downloading uses the existing episode add-on lookup and engine-A RAM
  flow. A title never rented takes that same normal flow after an empty lookup.
- No browser/GUI automation or visual/playback verification was performed;
  that acceptance belongs to the owner. No dependency or UI was added.
- **Next task:** P4 under the owner's next brief: seeding window/caps and
  playback-priority queue scheduling from design §§11/20/21/22. Settle the
  upstream measurement mechanism before implementing settings; preserve this
  exact-content playback branch and the unchanged engine-A startup ordering.

2026-10-19 D-034 rented tapes P2b pure-TypeScript layer:
- `src/rentals/tapeManifest.ts` (new) is the app-owned manifest model. Its types
  mirror `tape-store.json` v1 and its validation copies the bounds in
  `src-tauri/src/tape_store.rs` one for one: ten rows, `version` exactly 1, no
  unknown fields on the document, the row or the descriptor, lower-case 40-hex
  infohash, `fileIdx` 0..9999, size 1..=Number.MAX_SAFE_INTEGER, bounded UTF-8
  text without control characters, `descriptor.sources` at most 64 × 2048 bytes,
  a `magnet:` prefix, a base64 `.torrent` at most 8 MiB decoded and a 16 MiB
  encoded manifest. `normalizeManifest` reads corrupt storage as the empty
  manifest (§8) and drops a malformed row whole instead of trusting half of it;
  `upsertTape`/`touchTape` return `null` rather than a manifest the native writer
  would reject, and `totalBytes` saturates at the safe integer.
- `src/rentals/tapeAdmission.ts` (new) admits by the smaller of the GB ceiling
  (`locadora.tapes.maxGb`, default 6, `0` = no ceiling) and
  `freeBytes - 2 GiB`. `freeBytes` is optional and may be `null`: P2b admits by
  the ceiling alone until a native `statvfs` call lands with the settings
  surface. `tapeCountCap` follows the rental limit when `maxCount` is `0` and
  never lets a separate cap exceed it or the ten-row store ceiling. The closed
  refusal set is `unknown-size`, `cap-exceeded`, `space-exceeded`,
  `count-exceeded`, checked in that order. A refusal is a pure function of its
  input, so it cannot mutate a manifest or delete a tape.
- `src/rentals/tapeQueue.ts` (new) is the state machine:
  `queued → resolving → downloading → ready`, plus `failed`, `returned` and
  `unverified`. One active download, FIFO by rent time with ties in enqueue
  order. The driver is injected (`{ start, cancel }`), so the tests run with no
  shell and no real download. A `reading` event promotes `resolving` to
  `downloading` and updates bytes monotonically; only the active job's matching
  hash **and** file index may move at all. Failure is classified from the
  driver's rejection (`readTapeFailureCode`) and retried at most once per tape
  per app session (`MAX_TAPE_ATTEMPTS_PER_SESSION = 2`); a retried tape returns
  to its rent-time position and the queue never starts a download by itself, so
  a retry can never become a tight loop. `torrent-not-found` marks the tape
  `unverified` instead of retrying (§8); `too-large`, `invalid-request` and
  `cancelled` never retry. `cancelForReturn` frees the slot, calls the driver's
  `cancel` and leaves every other job untouched.
- `src/platform/tape.ts` (new) wraps `tape_engine_ensure`,
  `tape_engine_request`, `tape_store_read`/`write`/`clear`,
  `tape_download_start`/`cancel` and the `tape-download-progress` event, with no
  policy beyond marshalling and the allowlist checks the native bridge already
  enforces. Every rejection becomes a `TapePlatformError` carrying one of the
  six native codes, malformed progress payloads are dropped instead of
  forwarded, a lossy manifest write is refused instead of truncated, and
  `createTapeDownloadDriver()` is the native implementation of the queue's
  injected driver.
- Nothing is wired in: `App.tsx`, the player, the inspector, the member panel,
  the Quick Watch evaluator, the resume store and every Rust file are untouched.
  No dependency was added and nothing was pushed.
- Checks: `npm run check` exited 0 — TypeScript passed; Test Files 50 passed
  (50), Tests 346 passed (346) (was 46/291); Vite built 193 modules with only the
  existing large-chunk advisory.
- Mutation checks (each reproduced and restored):
  - ceiling comparison `>` → `>=`: three admission tests failed
    (`expected { allowed: false, …(1) } to deeply equal { allowed: true }`);
  - `MAX_TAPE_ATTEMPTS_PER_SESSION = 3`: three queue tests failed (retry-once,
    synchronous-throw retry, retry-goes-to-the-back);
  - infohash pattern widened to `[0-9a-fA-F]`: six tests failed across the
    manifest and platform suites;
  - single-active guard removed: `keeps exactly one download active` failed.
- Choices this part made where the plan was silent, recorded so a later part can
  reverse them deliberately: refusal order is size → ceiling → space → count; a
  corrupt `maxGb` falls back to 6 GB instead of disabling the ceiling; a retried
  tape goes to the back of the FIFO rather than being retried immediately; the
  queue never auto-pumps after a completion, a failure or a cancellation;
  `failed` and `unverified` rows still occupy a count slot and their declared
  size still counts against the ceiling; timestamps are ISO strings compared
  lexicographically.
- **Next task:** P3 — playback switch. Accept
  `http://127.0.0.1:11472/<40-hex>/<idx>` in the player URL predicate next to
  the existing 11471 check, play the tape engine's copy when the manifest row is
  `ready`/`seeding` and the file is present, and otherwise keep the RAM path
  byte-for-byte. The wiring P2b deliberately left out: read `readTapeManifest()`,
  build jobs from rows with `createTapeDownloadDriver()` in `createTapeQueue`,
  persist transitions through `touchTape` + `writeTapeManifest`, admit with
  `admitTape` (`freeBytes: null` until a native `statvfs` command exists), and on
  return call `cancelForReturn`, remove the engine torrent, then the manifest
  row.

2026-10-19 D-034 rented tapes P2a native download driver:
- `src-tauri/src/tape_download.rs` (new, 729 lines) adds
  `tape_download_start(infoHash, fileIdx)` and `tape_download_cancel()`.
  It opens the tape engine's own `http://127.0.0.1:11472/<hash>/<idx>`, reads to
  EOF **discarding every byte** (the engine owns the piece data; the app never
  writes media bytes), and emits at most one `tape-download-progress` event per
  second carrying `infoHash`, `fileIdx`, `readBytes`, optional `totalBytes` and a
  closed state. Failures map to a closed set (`engine-unavailable`,
  `torrent-not-found`, `invalid-request`, `read-failed`, `too-large`,
  `cancelled`); no URL ever enters a payload. One active download at a time;
  `MAX_BYTES` is 16 GiB; connect 10 s, idle read 120 s, total 48 h.
- The delegated run hit Codex's usage limit after writing the module and its
  tests but before running the gates or committing. The work was finished and
  verified here instead of being re-run: `cargo test` 52 passed / 2 ignored
  (was 41/2), `clippy -D warnings` clean, `cargo fmt --check` clean,
  `npm run check` 46 files / 291 tests.
- Mutation checks (both reproduced and restored):
  - guard removed (`if false && active.is_some()`): `single_active_download_...`
    failed at `second active download accepted`;
  - ceiling raised (`MAX_BYTES = u64::MAX - 1`): `size_ceiling_rejects_declared_
    and_unannounced_excess` failed with `left: 18446744073709551614, right:
    17179869184`.
- **Next task:** P2b — manifest, admission and queue in TypeScript on top of
  P1/P2a, per `docs/RENTED_TAPE_DOWNLOAD_AND_SEEDING_PLAN.md` §9/§21: admission
  by `locadora.tapes.maxGb` and manifest total with `freeBytes` accepted as
  unknown until a native `statvfs` call lands with the settings surface;
  single-active queue driven by `tape_download_start` events, retry-once, and
  cancellation on return.

2026-10-19 D-034 rented tapes P1 native surface complete:
- `EngineState` now supervises a second, independent `TapeEngine`, but only
  `tape_engine_ensure` can start it. It reserves fixed loopback port 11472,
  reuses the pinned/materialized D-018 binary, and points `APP_PATH` at the
  private app-data `tape-store` directory. Its separate environment leaves the
  memory-cache variable unset, disables idle reclaim, sets unlimited seed ratio,
  defaults the peer port to 6881, and starts with a 256 MiB process limit.
  Startup posts `cacheSize: null` and `seedingEnabled: true`; shutdown stops the
  owned process but deliberately never removes the durable store.
- Engine A remains textually unchanged at its behavior boundaries: port 11471,
  URL, RAM-cache and 512 MiB env table, 30-second idle reclaim, ephemeral
  session directory, `remove_dir_all` teardown, request bridge, ensure/status
  commands and pre-existing lifecycle/allowlist tests. No player, frontend,
  queue, rental, series or CSP path changed.
- `tape_engine_request` has its own fixed-origin validator. It accepts only
  lower-case 40-hex tape paths in the frozen optional index/action grammar,
  maps POST to `create` and GET to non-`create` paths, rejects query/userinfo/
  fragments, limits request bodies to 3 MiB and permits a body only on create.
  Responses retain the existing 2 MiB bridge ceiling without widening Engine
  A's bridge.
- The new typed `tape_store_*` commands own `tape-store.json` under app data.
  The v1 shape is strict and bounded (at most ten rows, 16 MiB encoded manifest,
  8 MiB decoded torrent payload per row, lower-case hash, file index at most
  9999 and JavaScript-safe positive byte size). Writes create a mode-0600 temp
  file, write and fsync it, rename it over the destination and fsync the mode-
  0700 parent. Missing, malformed, oversized or shape-invalid files read as
  `null`; clear removes only the app-owned manifest.
- Teardown mutation check: after temporarily changing `TapeEngine::stop` to
  `remove_dir_all(store)`, `cargo test --manifest-path src-tauri/Cargo.toml
  streaming_engine::tests::tape_engine_conflict_is_fail_closed_and_drop_preserves_store
  -- --exact --nocapture` failed as required with `tape engine teardown removed
  its durable store`. Restoring the non-deleting teardown made the same command
  pass (1 passed, 42 filtered out).
- Final native gate: `cargo test --manifest-path src-tauri/Cargo.toml` exited 0
  — 43 library tests discovered, 41 passed and 2 ignored; main and doc tests
  each ran 0. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
  -- -D warnings` exited 0. `cargo fmt --manifest-path src-tauri/Cargo.toml
  --check` exited 0.
- Unchanged JS gate: `npm run check` exited 0 — TypeScript passed; Test Files
  46 passed (46), Tests 291 passed (291); Vite built 193 modules with only the
  existing large-chunk advisory. No browser/GUI automation, manual visual or
  playback validation was performed. No dependency was added and nothing was
  pushed.
- **Next task:** implement D-034 P2 from
  `docs/RENTED_TAPE_DOWNLOAD_AND_SEEDING_PLAN.md` §21: pure-TypeScript manifest
  lifecycle, admission and one-at-a-time download queue over this native
  surface, without changing player URL policy or Engine A.


2026-10-19 D-033 local resume positions complete:
- D-033 records the owner's approval and supersedes D-005's disabled resume
  history plus D-031's unpersisted playback position. Resume data is desktop
  local only: no Worker, Locadora API, analytics or synchronization path was
  added. The store uses the same `videoDelayIdentity()` file/URL identity as
  subtitle delay, never candidate rank, display copy or seeder metadata.
- `src/media/resumePositionStore.ts` stores validated position/duration seconds,
  integer write time and optional all-or-nothing series/season/episode context
  under `locadora:resume:v1:`. It rejects malformed, negative, non-finite and
  at/after-duration values; positions at or beyond 95% or within 30 seconds of
  the end are finished and are cleared rather than resumed. Reads expire records
  after 90 days. Every write also removes malformed, expired or finished rows
  and caps the store at 300 rows by pruning the oldest write time first.
- `WatchFlow` reads the record only after a concrete candidate supplies that
  identity and passes its millisecond equivalent to `useStremioVideo`; the
  load command and its stalled direct-route retry use the same start time. A
  different release/file identity receives `0`. Once loaded, a resumed video
  shows an accessible localized overlay for eight seconds with the resume time
  and `Começar do início` / `Start from the beginning`; taking it seeks to zero
  and clears that identity's record.
- A started video writes at a five-second cadence, on the transition to pause,
  on player close, on page hide and on component unmount. The writer requires
  `loaded`, a positive reported time and duration, so a source that never starts
  creates no resume record. Source switching persists the previous release
  before resolving the next identity. Movies use the same store without series
  context.
- The episode auto-mark threshold still uses ended or at least 90%, but a
  resumed episode cannot satisfy it until reported playback reaches at least 30
  seconds beyond the resumed point. Auto-marking disables further persistence
  for that loaded episode. Single-episode and whole-season watched writes clear
  every matching release position; forgetting one series clears its positions,
  clearing all series progress clears series positions but retains movies, and
  `clearLocalCache()` clears all resume positions.
- D-033 also clarifies the decision log's boundary: playback never changes a
  rental or return watched status automatically; D-031/D-033's local episode
  progress is independent. No quick-watch rule, episode cache, member panel,
  engine, torrent behavior, buffering/decode option, Rust file or dependency
  changed.
- Focused checks: `npm run typecheck` exited 0; `npx vitest run
  test/resumePositionStore.test.ts test/useStremioVideo.test.tsx
  test/watchFlow.test.tsx test/seriesEpisodes.test.ts
  test/localSeriesProgress.test.ts` exited 0 — Test Files 5 passed (5), Tests
  66 passed (66).
- Full gate: `npm run check` exited 0 — TypeScript passed; Test Files 46 passed
  (46), Tests 291 passed (291); Vite production build passed with 193 modules
  and the existing large-chunk advisory. The baseline was 45 files / 281 tests;
  one focused store file and ten tests are additive, with none removed.
- `git diff --check` passed before the full gate. Only the JS gate was run: no
  cargo, Tauri build, browser/GUI automation or manual playback/visual check was
  performed, per the brief.
- **Next task:** owner rebuilds/runs the desktop app and manually verifies D-033
  with one same-release reopen, a different-release reopen, the start-over
  escape, a near-end position, and watched/forgotten-series clearing. The older
  P7 and immersive-search visual acceptance items remain open on the owner side.

2026-10-19 immersive search entry complete:
- In immersive (3D) mode the header now exposes one search action
  (`Buscar título` / `Search titles`) that opens the existing `TitleSearch`
  window directly, the same window the 2D button opens. The intermediate
  "Buscar fitas" panel is gone: its toggle button, the `immersiveFiltersOpen`
  state and the panel's own copy of the title-search button were removed rather
  than left inert. Nothing about the sort control was relocated: the 3D plaque
  already owns genre, year and sort, and this was verified by reading
  `ImmersiveShelf.tsx` before any edit — the plaque passes
  `onConfigure(index, draft.year, draft.sort)` with `sortLabel` and
  `sortChoices` ([relevance, year, rating]), and `App.configureImmersive`
  applies all three (draft plus committed sort, persisted to `locadora.sort`).
- The `browse-controls` block is now rendered only when immersive mode is off.
  Removing the `hidden` attribute and the immersive branch left three dead CSS
  rules, which were deleted in the same commit: `.browse-controls
  .browse-title-search` (the removed immersive button's class),
  `.browse-controls[hidden]`, and the `.browse-controls` half of
  `.is-immersive .browse-controls, .is-immersive .settings-drawer` (the
  `.is-immersive .settings-drawer` half is kept). The shared
  `.browse-controls` layout, picker and 900px/680px media rules stay: they
  still serve 2D.
- 2D mode is unchanged: genre, year and sort are mounted together in
  `browse-controls`, genre applies immediately, the year draft costs nothing
  and the transactional apply stays on `Ir` (`applyYear` commits year and sort
  together, one shelf request), and the 2D `Buscar título` button keeps
  opening the same title-search window.
- Tests updated in `test/appTitleSearchImmersive.test.tsx`: the immersive case
  now asserts the search action exists, that `Buscar fitas` is gone, that no
  `.browse-controls`, no `.sort-picker` and no genre/year/sort control exist in
  immersive, and that clicking the action opens the search dialog with its
  searchbox directly. The 2D case now also asserts all three controls live
  inside `browse-controls`, that picking a sort draft alone triggers no load,
  and that `Ir` sends one request carrying the chosen genre, year and sort.
- No 3D scene, `ImmersiveShelf`, plaque control, shelf loading/filtering,
  series/quick-watch, member-panel or Rust file changed; no dependency and no
  new component was added. No decision entry was needed.
- Focused check: `npm test -- test/appTitleSearchImmersive.test.tsx
  test/app.test.tsx` exited 0 — Test Files 2 passed (2), Tests 15 passed (15).
- Full gate: `npm run check` exited 0 — TypeScript passed; Test Files 45 passed
  (45), Tests 281 passed (281); Vite production build passed with 192 modules
  and the existing large-chunk advisory. The 45/281 counts match the stated
  baseline exactly: the same two tests were rewritten, none added or removed.
- `git diff --check` passed. Only the JS gate was run: no cargo or tauri build
  was started, no desktop binary was rebuilt. No browser/GUI automation and no
  manual visual check was performed; the owner does the immersive visual check.
- **Next task:** owner visually verifies the immersive header's single search
  action on the rebuilt desktop build and names the next milestone. The
  previous P7 manual acceptance (next-episode offer, season mark/unmark,
  specials reveal, episode context) is still open on the owner's side.

2026-10-19 series follow-up P7 complete:
- A finished episode now *offers* the next one and never autoplays. `WatchFlow`
  keeps a local `activeEpisode` (initialised from its `episode` prop), and only
  when the video actually reports `ended` for the episode whose source loaded
  does it read `readLocalSeriesEpisodes()` plus `readSeriesProgress()` once and
  delegate to the existing `nextEpisode(episodes, watched, pointer)`. Nothing is
  fetched inside the player: a cache that cannot answer simply shows no offer.
  The offer is a compact `role="group"` control in the dock with one play button
  (`Próximo TxxExx` / `Next TxxExx`) and one dismiss button; taking it sets
  `activeEpisode`, clears the old candidate/resolution and lets the existing
  resolution path resolve and play the new episode, dismissing leaves everything
  as it was and the offer does not return for that episode. Episodes already
  watched past the current one are skipped, and the offer never appears when the
  series is finished. A new episode is a new video identity: the previous
  candidate, its subtitle-delay identity and the manual picker state are cleared
  across the switch.
- The episode picker can mark or unmark a whole season through one new
  `setSeasonWatched()` write path: one read-modify-write of the same per-episode
  progress keys the single toggle writes, one stored record, no per-episode loop.
  The pointer lands on the season's last episode when marking and on its first
  when unmarking, so "continue" moves past a marked season but still reaches an
  unmarked one. No rental, return, review, donation or member state is touched.
- Season 0 is revealed by an explicit `Mostrar/Ocultar especiais` control
  (`aria-pressed`); only then does the season selector include it and the episode
  list render it like any other season (label `T00Exx`, its own air date and
  context). Because local progress keys are normal seasons only, season 0 rows
  deliberately carry no per-episode or season watched toggle.
- Episode context: the parsed episode shape gained a bounded `overview`
  (`boundedOverview`, 400 characters, markup stripped, plain text in the DOM) and
  already had `released`. The picker shows a `Contexto do episódio` block for the
  selected episode — the row the user is focused on, defaulting to where
  "continue" points in that season — with its label, air date and synopsis. The
  parsed shape changed, so `CACHE_VERSION` moved from 2 to 3 and episode lists
  cached by an earlier build are ignored (and re-fetched) instead of being
  rendered without their context; cached overviews are re-normalised on read and
  a non-text synopsis rejects the record. The same bump invalidates pre-P7 shelf
  and title rows, which is the existing version-prefix discipline.
- P6's optional extra landed: the watched marker on a series case now carries the
  next episode label in its accessible name (`<title>: N episódios assistidos,
  próximo T01E03` / `... , next T01E03`). `App` derives it from the same single
  progress read plus one cached episode read per in-progress series on the shelf;
  no fetch, and a missing list leaves the count-only label exactly as P6 wrote it.
- No dependency, Rust file, engine, torrent, `quickWatch.ts`, `normalization.ts`,
  `MemberPanel.tsx` or native image boundary changed; no episode thumbnail,
  image host, autoplay of an untaken offer, persisted playback position, new
  store, season-level rental or new decision entry was added. P7 also changed
  nothing about D-032's frozen series Quick Watch rules.
- Focused check: `npx vitest run test/seriesEpisodes.test.ts
  test/localSeriesProgress.test.ts test/localCatalogueCache.test.ts
  test/localCacheSchema.test.ts test/seriesEpisodePicker.test.tsx
  test/watchFlow.test.tsx test/shelfStands.test.tsx` exited 0 — Test Files 7
  passed (7), Tests 67 passed (67); one earlier run failed one picker assertion
  because the raw `&amp;` in the fixture overview is kept verbatim (entities are
  not decoded), and the expectation was corrected rather than the parser changed.
- Full gate: `npm run check` exited 0 — TypeScript passed; Test Files 45 passed
  (45), Tests 281 passed (281); Vite production build passed with 192 modules
  and the existing large-chunk advisory. The baseline before this part was 45
  files / 266 tests, so the fifteen new assertions are additive: no test was
  removed, and `CACHE_VERSION`'s bump required two hard-coded cache-key literals
  in existing tests to move from `2:` to `3:` (the previous-version record test
  now explicitly writes `2:` and expects to be ignored).
- `git diff --check` passed. Only the JS gate was run: no cargo or tauri build
  was started and no desktop binary was rebuilt, per the brief's scope. No
  browser/GUI automation, manual visual check, real progress database, real
  add-on response or playback validation was performed; the owner does the
  visual check.
- **Next task:** owner manually verifies the P7 flows on the rebuilt desktop
  build (an episode ending mid-series and at the end of a series, the season
  mark/unmark action, the specials reveal and the episode context block). With
  P7 in, every part of `docs/SERIES_FOLLOWUP_PLAN.md` (P1-P7) is implemented, so
  the next milestone comes from the owner unless the manual check turns up a
  defect.

2026-10-19 series follow-up P6 complete:
- The series episode picker no longer collides with the immersive header actions.
  In immersive mode only, `.tape-episodes` is anchored below the header-actions
  bar (`top: 4.6rem`, and `6.5rem` once the header chips wrap under 600px) and
  its height is capped to `min(calc(50vh - 7rem), 520px)`, so it also stops
  above the vertically centred stand controls. It stays `position: fixed`, keeps
  `overflow: auto`, and keeps its DOM order, tab order and keyboard access. The
  2D placement (`.tape-episodes { position: fixed; z-index: 5; top: 1rem; right:
  clamp(4.5rem, 7vw, 6rem); ... }`) and its 900px/680px variants are unchanged;
  `.is-immersive` outranks them by class count, so the immersive rule applies at
  every width without touching the 2D numbers. A source guard asserts both.
- A series case now shows a small watched marker when that series has local
  progress. `App` reduces the rendered titles to one series-identity key and
  calls the existing `readAllSeriesProgress()` once per shelf, not once per card,
  then passes a watched-episode count to each `VhsTape`. A series with no local
  record renders nothing at all. The marker is a sibling of the tape button, so
  the inspect button keeps its exact accessible name and its single tab stop; it
  is `role="img"` with a localized `aria-label` (`<title>: N episódios
  assistidos` / `<title>: N episode(s) watched`), is not focusable, and is
  `pointer-events: none` so no click target or hit region changes.
- The marker's accessible name carries the watched-episode count rather than the
  optional next-episode label (`T16E05`): that label needs the parsed episode
  list, so it would add a per-series episode read beyond the single progress
  read this part requires. It belongs with P7's episode context. No marker was
  placed on the 3D cases: the packed rack/case geometry is out of scope and a
  canvas case cannot carry an accessible label, so the accessible 2D tape is the
  surface that marks progress.
- No 3D geometry, web-scene module, native IPC command, progress writer, cache
  implementation, series rule, member action or player behaviour changed, and no
  dependency, new component file or new store was added. No decision entry was
  needed: this is placement plus a read-only badge, not a contract change.
- Focused check: `npm run typecheck` exited 0; `npx vitest run
  test/shelfStands.test.tsx test/artworkCache.test.tsx` exited 0 — Test Files 2
  passed (2), Tests 7 passed (7). The first focused run failed one assertion
  (`readAllSeriesProgress` called 3 times for a single shelf) because the read
  was keyed on the `pages` array, whose empty reset gives it a new identity on
  mount; the key is now the rendered series-identity set and the same test
  passes with one call.
- Full gate: `npm run check` exited 0 — TypeScript passed; Test Files 45 passed
  (45), Tests 266 passed (266); Vite production build passed with 192 modules
  and the existing large-chunk advisory. The baseline before this part was 45
  files / 262 tests, so the four new assertions are additive.
- `git diff --check` passed. Only the JS gate was run: no cargo or tauri build
  was started and no desktop binary was rebuilt, per the brief's scope. No
  browser/GUI automation, manual visual check, real progress database or
  playback validation was performed; the immersive visual check stays with the
  owner.
- **Next task:** implement series follow-up P7 from
  `docs/SERIES_FOLLOWUP_PLAN.md` §10: an offer (never autoplay) for the next
  episode after `ended`, resolving its source only when the offer is taken;
  marking and unmarking a whole season with the same progress records; the
  season-0 specials reveal; and bounded episode art/context (thumbnail,
  overview, air date) that never stores the raw payload.

2026-10-19 series follow-up P5 complete:
- Carteirinha now follows the web account diagram while retaining the desktop
  app's existing dark-blue palette, typography, spacing variables and component
  vocabulary: monogram/member identity with inline username edit, explicit
  rental-limit save and status, rented/recent/saved stats, personal shelves,
  active rentals with Balcão return choices, collapsed history, then sign out.
  Every structural section has an accessible heading and `aria-labelledby`;
  the enclosing modal and its Escape/backdrop/close-button behavior are
  unchanged. No web CSS was copied.
- Watch-later and favorites retain D-020's three-title previews and separate
  complete-list actions. Their new sibling appears only when local series
  progress resolves to a cached next episode. It reads
  `readAllSeriesProgress()` and `readLocalSeriesEpisodes()`, delegates selection
  to the existing `nextEpisode(episodes, watched, pointer)`, caps the compact
  preview at three most-recent progress records, never fetches an episode list,
  and performs no write. Completed, cache-missing and canonically unresolved
  records are omitted.
- A progress IMDb id is mapped only to canonical title snapshots the app
  already knows from the current shelf, the bounded in-session inspection list,
  Cesta or local saved collections. This keeps inspection on an actual TMDB
  identity without changing the progress/cache schemas or inventing an IMDb to
  TMDB mapping. The in-session inspection list is bounded to 64 and is not a
  new persistent store.
- All member service calls and payloads are unchanged. Coverage now exercises
  sign in/up/out, inline profile save, explicit rental-limit save, all three
  return values (`watched`, `not_watched`, `unknown`), review publication,
  history pagination/deduplication, three-item saved previews, block order,
  dialog-cancel close behavior, cached next-episode inspection, and complete
  absence of the continue block when there is no progress.
- The web TV-pairing and default-streamings blocks have no desktop-app
  counterpart and remain absent by design. No provider filter, pairing action,
  dependency, member Worker/contract, request payload, media/player behavior,
  series rule, progress writer or cache implementation changed.
- Baseline: `npm test` exited 0 — Test Files 45 passed (45), Tests 256 passed
  (256).
- Final focused check: `git diff --check && npm run typecheck && npm test --
  test/memberPanel.test.tsx test/app.test.tsx` exited 0 — Test Files 2 passed
  (2), Tests 24 passed (24).
- Full gate: `npm run check` exited 0 — TypeScript passed; Test Files 45 passed
  (45), Tests 262 passed (262); Vite production build passed with 192 modules
  and the existing large-chunk advisory.
- Desktop rebuild: `npm run tauri -- build --no-bundle` exited 0 and refreshed
  `src-tauri/target/release/wills-locadora-player` (release compilation 1m31s).
  No browser/GUI automation, manual visual check, real member request, real
  progress database or playback validation was performed.
- **Next task:** implement series follow-up P6 from
  `docs/SERIES_FOLLOWUP_PLAN.md` §9: verify and fix the episode picker's
  immersive placement/collisions while keeping 2D accessible, then add a small
  watched marker where a series tape appears without changing click targets or
  packed-shelf geometry. Manual immersive acceptance remains with the owner.

2026-10-19 series follow-up P4 complete:
- `fetchSeriesEpisodes()` now reads a parsed episode list from the existing
  local catalogue cache before inspecting configured metadata add-ons. Its
  signature, result union and typed failure reasons are unchanged. A successful
  non-empty parse is cached; raw add-on payloads, empty lists, malformed
  responses and failures are never written.
- The IndexedDB schema advances from 2 to 3 and adds `seriesEpisodes` with
  `keyPath: 'key'` plus the existing `savedAt` index convention. Keys are
  `${CACHE_VERSION}:${seriesId}` and `CACHE_VERSION` remains 2, preserving all
  current shelf/title records. Cached values are reconstructed only after
  validating the bounded parsed shape, including ordered season/episode
  identity, names and canonical release dates.
- The new store retains at most 64 series and prunes the oldest record by
  `savedAt`; its session fallback uses the same bound. The canonical
  `clearLocalCache()` path clears parsed episode lists with shelves, titles and
  progress. Empty results are deliberately not negative-cached so newly
  published metadata can appear on a later inspection.
- Focused cache/service check:
  `git diff --check && npm test -- test/localCatalogueCache.test.ts
  test/localCacheSchema.test.ts test/seriesEpisodeService.test.ts` exited 0 —
  Test Files 3 passed (3), Tests 12 passed (12).
- First full gate: `npm run check` exited 1 — Test Files 1 failed | 44 passed
  (45), Tests 4 failed | 252 passed (256). The existing
  `seriesEpisodePicker.test.tsx` whole-module cache mock did not expose the two
  new internal cache functions, so its service call followed the typed add-on
  failure path. Production code was unchanged by the repair.
- Final affected check:
  `git diff --check && npm test -- test/seriesEpisodePicker.test.tsx
  test/localCatalogueCache.test.ts test/localCacheSchema.test.ts
  test/seriesEpisodeService.test.ts` exited 0 — Test Files 4 passed (4),
  Tests 16 passed (16).
- Final full gate: `npm run check` exited 0 — TypeScript passed; Test Files 45
  passed (45), Tests 256 passed (256); Vite production build passed with 192
  modules and the existing large-chunk advisory.
- Desktop rebuild: `npm run tauri -- build --no-bundle` exited 0 and refreshed
  `src-tauri/target/release/wills-locadora-player` (release compilation 2m16s).
  `git diff --check` passed. No browser/GUI automation, manual visual check,
  real add-on response or playback validation was performed. No decision entry,
  dependency, UI, player, progress-position, Rust, member or rental change was
  made.
- **Next task:** implement series follow-up P5 from
  `docs/SERIES_FOLLOWUP_PLAN.md` §8: restructure Carteirinha using the web
  block order while preserving the app styling/actions, and add the local-only
  continue-watching preview beside watch-later and favourites. Keep absent web
  counterparts absent rather than inventing provider or TV-pairing features.

2026-10-19 series follow-up P3 complete:
- The open immersive “Buscar fitas” panel no longer mounts the 2D genre picker
  or year machine. The title-search action remains available there, while the
  existing sort selector is unchanged. The 3D plaque remains the owner of its
  genre, year and sort controls and still applies them through `onConfigure`.
- The 2D `browse-controls` path is unchanged: it still mounts the genre select,
  year picker/form and sort select. Regression coverage proves a 2D genre
  interaction causes one shelf request, choosing a draft year causes none, and
  submitting that year causes one request with the current genre and year.
- No `aria-controls` reference targeted the removed copies. The “Buscar fitas”
  trigger remains focused and keyboard-operable when it opens the panel; no
  plaque, `ImmersiveShelf`, shelf-loading or apply-path code changed.
- Focused check:
  `npm test -- test/appTitleSearchImmersive.test.tsx test/app.test.tsx` exited 0
  — Test Files 2 passed (2), Tests 15 passed (15).
- Full gate: `npm run check` exited 0 — TypeScript passed; Test Files 45 passed
  (45), Tests 251 passed (251); Vite production build passed with 192 modules
  and the existing large-chunk advisory.
- Desktop rebuild: `npm run tauri -- build --no-bundle` exited 0 and refreshed
  `src-tauri/target/release/wills-locadora-player`.
- `git diff --check` passed. No browser/GUI automation, manual visual check,
  real add-on response, playback or plaque-interaction validation was performed.
  No decision entry was needed for this mode-specific duplication fix.
- **Next task:** implement series follow-up P4 from
  `docs/SERIES_FOLLOWUP_PLAN.md` §7: add a bounded, version-invalidated cache of
  parsed episode lists keyed by IMDb series id, read it before fetching, retain
  a good cached entry on fetch failure, and cover cache hits, corrupt/versioned
  records and oldest-entry eviction.

2026-10-19 series follow-up P2 complete (D-032):
- `WatchFlow` now accepts a playable winner from the series evaluator for a
  selected episode. This removes the temporary D-006 episode guard exactly as
  D-032 requires; title-level series streams remain outside this flow.
- Every no-winner result still opens the manual picker. An all-over-1 GB manual
  set gets the season-pack explanation; every other series-v1 no-winner result
  gets the generic unusable-episode explanation. Both messages and the selected
  episode-source explanation exist in PT-BR and English. Movie copy is unchanged.
- Episode pickers default to `SERIES_QUICK_WATCH_V1.preferredResolution` (1080p).
  `Todas/All`, each returned fallback resolution and unknown resolution remain
  available; films continue to default to all resolutions.
- Replaced the obsolete never-autoplay assertion with episode-winner playback,
  pack-only fallback/no-load, bilingual explanation, resolution availability and
  default coverage. The existing movie winner assertion now verifies the same
  playable source still loads. The watched-threshold test follows the automatic
  episode load instead of manually choosing the same source first.
- First focused run after wiring:
  `git diff --check && npm test -- test/watchFlow.test.tsx test/sourcePicker.test.ts test/resolutionService.test.ts`
  exited 1 — Test Files 1 failed | 2 passed (3), Tests 1 failed | 28 passed
  (29), because the watched-threshold setup still expected the obsolete picker.
- Final focused run with the completed localized cases: the same command exited
  0 — Test Files 3 passed (3), Tests 32 passed (32).
- Full gate: `npm run check` exited 0 — TypeScript passed; Test Files 45 passed
  (45), Tests 250 passed (250); Vite production build passed with 192 modules
  and the existing large-chunk advisory.
- Desktop rebuild: `npm run tauri -- build --no-bundle` exited 0 and refreshed
  `src-tauri/target/release/wills-locadora-player`.
- `git diff --check` passed. No browser/GUI, real add-on response, real source,
  playback or visual validation was performed. No Quick Watch rule, alias,
  ranking, cache, progress-store, engine, Rust or dependency change was made.
- **Next task:** implement series follow-up P3 from
  `docs/SERIES_FOLLOWUP_PLAN.md` §6: in immersive mode remove the duplicated
  genre and year controls from the open “Buscar fitas” panel while keeping title
  search there; preserve all three controls and the transactional apply path in
  2D, and update the mode-specific layout tests in the same commit.

2026-10-19 owner priority change — series follow-up P1 complete (D-032, `d72a539`):
- Owner prioritizes episode autoplay by its own rules and correct The Pirate Bay
  naming ahead of the prior manual episode-flow acceptance handoff. P1 implements
  only normalization and the pure evaluator from `docs/SERIES_FOLLOWUP_PLAN.md`.
- The starting tree had ` M docs/SERIES_FOLLOWUP_PLAN.md`; that owner edit remains
  untouched by P1 and was committed separately as `1187fa8` during this run.
  It is excluded from this milestone commit. Only the desktop repo is
  changed. No player, UI, resolution service, cache, episode parser or Rust edits.
- Added bounded TPB variants plus EZTV, TorrentGalaxy and LimeTorrents. Unknown
  structured source/display text is preserved; only empty input uses Other.
- `SERIES_QUICK_WATCH_V1` mirrors the movie ladder using binary 100–500 MB,
  >500 MB–1 GB, 20 seeders and the same source order. Named sources beat unnamed
  ones within an episode tier/size bucket; movie ranking stays unchanged. Result
  reasons retain their shape and `rulesVersion` identifies series-v1. See D-032
  for all implementation choices and how it supersedes D-006's episode rule.
- Baseline: `npm test` exit 0 — Test Files 45 passed (45), Tests 187 passed (187).
- Focused: `npm test -- test/normalization.test.ts test/quickWatch.test.ts`
  exit 0 — Test Files 2 passed (2), Tests 78 passed (78).
- First full gate: `npm run check` exit 1 — Test Files 1 failed | 44 passed
  (45), Tests 1 failed | 241 passed (242). The existing resolution-service test
  expects unconditional series manual selection for a qualifying 1 GB episode;
  clarification is pending to update only that test, without service changes.
- `npm run tauri -- build --no-bundle` initially failed at `spawnSync tar EPERM`
  under the sandbox; the same command passed with build permissions (exit 0),
  refreshing `src-tauri/target/release/wills-locadora-player`.
- No browser/GUI, real add-on response or playback validation performed.
- Owner approved the test-only scope clarification for
  `test/resolutionService.test.ts`; the obsolete assertion was updated without a
  service change. Final `npm run check` exited 0 — Test Files 45 passed (45),
  Tests 243 passed (243), with TypeScript and the Vite production build passing.
  P1 was committed as `d72a539`; P2 above fulfills its playback handoff.


2026-10-18 owner follow-ups after Part 3 (D-031):
- Owner asked for the two fixes that stood between the milestone and using it.
  1. The metadata default was seeded only for a completely empty configuration,
     so a user whose add-ons came from a Stremio import (streams and subtitles
     only, the common case) could never get an episode list. Seeding is now
     decided by the configuration itself: any configuration with an add-on that
     declares the `meta` resource needs nothing, and one that cannot answer
     `meta` gets the public default appended after it, order preserved. The
     recorded-seed flag keeps a failed attempt from repeating, `add` and
     `import` no longer set it (they answer "what is configured", not "can meta
     be answered"), while `remove` and `disconnect` still do, so a deliberate
     emptying is never re-seeded.
  2. Progress had no user-facing way to be forgotten. The series episode picker
     gains `Esquecer progresso` / `Forget progress` beside the continue action,
     scoped to that one series through `clearSeriesProgress()`; `clearLocalCache()`
     still clears everything.
- Checks: `npm run check` exit 0 — TypeScript, Vitest 186 tests/45 files, Vite
  production build. Focused: `test/mediaConfigurationDefault.test.ts` (4 tests)
  and `test/seriesEpisodePicker.test.tsx` (4 tests).
- The release binary was rebuilt after these changes so the owner can run the
  alias and retest.

2026-10-18 series episode tracking, Part 3 complete (D-031):
- The existing catalogue IndexedDB now upgrades from schema version 1 to 2 and
  adds a `progress` store keyed as `progress:<seriesId>`. `CACHE_VERSION`
  remains 2, so the schema upgrade preserves title/shelf cache keys. Progress
  records keep the server-shaped D-031 fields, validate stored input and retain
  only the newest 500 watched timestamps. Individual and bulk read/write/clear
  operations are exposed; the canonical `clearLocalCache()` clears progress in
  the same transaction as shelves and titles.
- This checkout had no pre-existing local-cache clear function or UI caller to
  extend. The similarly worded Media Settings action deletes protected add-on
  configuration and was deliberately not overloaded. `clearLocalCache()` is
  therefore the single cache-clear path, and its progress behavior is covered
  directly; adding a new settings action was outside Part 3 rather than
  inventing a second path.
- Episode playback marks watched at `time / duration >= 0.9` or `ended`, using
  the existing Stremio Video state. A per-WatchFlow episode guard permits one
  write per episode per mounted player session. No playback position is stored,
  and the write touches no rental, return, collection, review or donation state.
- The 2D episode picker reads local progress, labels watched episodes, and uses
  the same write path for manual mark/unmark. Its primary playback action uses
  `nextEpisode()` with the stored pointer: `Continuar TxxExx` when watched
  progress exists and `Começar TxxExx` at the first known normal episode when
  none exists. A fully watched list reports the series complete instead of
  wrapping or autoplaying. Every episode action still enters the Part 2 manual
  source picker under D-006.
- Focused checks passed: `npm test -- test/seriesEpisodes.test.ts
  test/localSeriesProgress.test.ts test/localCacheSchema.test.ts
  test/localCatalogueCache.test.ts test/seriesEpisodePicker.test.tsx
  test/watchFlow.test.tsx` (36 tests/6 files). `npm run check` passed, exit 0:
  TypeScript, Vitest 184 tests/45 files, and Vite production build (192 modules;
  existing large-chunk advisory). `git diff --check` passed.
- `npm run tauri -- build --no-bundle` passed and refreshed the optimized
  desktop binary. No GUI, browser, real metadata response, source selection or
  playback validation was performed. No dependency, Rust change, backend call,
  analytics or D-031 contract change was added.
- Next task: owner manually verifies the Part 3 desktop flow with a real series:
  choose an episode through the manual source picker, cross the 90%/ended mark,
  reopen the tape and confirm the watched badge plus `Continuar` target; also
  verify manual mark/unmark. Automated implementation is complete.

2026-10-18 series episode tracking, Part 2 complete (D-031):
- A series inspection now loads its bounded episode list through the Part 1
  service, hides season 0 by default, and presents a season selector plus
  `T16E05`-style episode actions with optional names. Typed Part 1 reasons cover
  missing IMDb identity, metadata configuration/failure, malformed metadata and
  empty normal-episode lists; rejected metadata never reaches the UI.
- Selecting an episode carries only its bounded season/episode identity into
  the existing `WatchFlow`. Stream and external-subtitle resource requests use
  the shared `episodeVideoId()` result (`tt…:S:E`) with content type `series`.
  Series still always enter the existing manual source picker; there is no
  Quick Watch, autoplay, next-episode action, season pack or progress storage.
  Movie resolution remains on its existing bare IMDb request.
- `nextEpisode()` accepts an optional resume pointer and skips unwatched gaps
  before that pointer. Tests cover no pointer, a mid-season pointer, the last
  episode of a season, a pointer beyond available metadata and watched gaps.
- Checks: `npm run check` passed, exit 0: TypeScript, Vitest 173 tests/43 files,
  and Vite production build (192 modules; existing large-chunk advisory).
  `git diff --check` passed. `npm run tauri -- build --no-bundle` passed and
  refreshed the optimized desktop binary. No GUI, browser, real metadata
  response, source selection or playback validation was performed.
- No D-031 contract changed, no dependency was added, and no new decision entry
  was needed.
- Next task: implement Part 3 from `docs/SERIES_EPISODE_TRACKING_PLAN.md` §5:
  add the versioned local progress store, watched threshold/manual toggle, and
  `Continuar`/`Começar` action using the resume pointer. Keep playback position
  unpersisted and keep all Locadora rental/member state untouched.

2026-10-18 series episode tracking priority change (D-031):
- Owner priority: "series episode support [is] the active milestone, ahead of
  the previous `Next task`." This supersedes the 2026-10-18 playback-hiccup
  checkpoint's handoff for the owner to name a next locadora-app priority.
- Part 1 follows `docs/SERIES_EPISODE_TRACKING_PLAN.md` §4 and §5. It adds
  bounded episode parsing, pure next-episode and identity helpers, a typed
  metadata fetch through the existing native `meta` command, and an empty-only
  public Cinemeta default. Part 2 and Part 3 remain out of scope here.
- Next task: after Part 1 is committed and green, implement Part 2 from
  `docs/SERIES_EPISODE_TRACKING_PLAN.md` §5: wire the composed episode ID into
  series stream resolution and add the 2D inspector episode selector with the
  existing manual source picker; preserve D-006 and do not start Part 3.

2026-10-18 playback hiccup milestone CLOSED (verified):
- The owner confirmed playback is smooth after the route fix. Verified on the
  live stream while it played: the session loaded the DIRECT file URL
  (127.0.0.1:11471/<infohash>/<index>, segments=2), `file-format=mkv`, and a
  20 s ffprobe window at the playhead (video 480 packets, audio 938 packets)
  reported zero gaps and zero duplicate timestamps - against the earlier
  "+0.080 s at every exactly 4.0 s boundary" on the HLS route. Counters were
  vo=0, dec=0, delayed=0 with a 120 s cache and no cache pause; the engine
  reported 9 peers at 3.4 MB/s, 83% of the stream fetched. Owner also synced
  subtitles with the in-app timing controls on the direct route, which is the
  subtitle-safety claim confirmed in practice.
- `hwdec-current` remains empty (software decoding) on the HEVC title measured,
  with zero dropped and zero delayed frames, so the decode escalation stays
  conditional rather than urgent.
- Next task: owner names the next locadora-app priority - the hiccup milestone is
  closed and D-029/D-030 carry its decisions. The only known-open playback item
  is the conditional hardware-decode escalation (copy-back first, then the EGL
  route), taken up only when a heavy source shows decoder drops.

2026-10-18 buffering middle term and honest underrun accounting (D-030):
- Owner direction: privilege weak connections over strong ones, because a good
  connection needs no help. `cache-pause-wait` 15 -> 8 s,
  `demuxer-max-back-bytes` 32 -> 64 MiB; read-ahead and forward byte ceiling
  unchanged at 120 s / 256 MiB. D-023 superseded. The embedded read-back
  regression carries the new values.
- Diagnostics: the opening cache fill is no longer counted as an underrun - it
  was, on every playback, because `paused-for-cache=false` arrives at load
  before the fill pause. A pause counts only after a `time-pos` sample shows
  progress; the first one is recorded as `initial-buffer`.
- The native child-player path stays: it is the documented diagnostic route and
  the only way the Rust tests drive a real mpv session.
- Checks: `cargo test --manifest-path crates/native-core/Cargo.toml --
  --test-threads=1` passed 22 tests; strict Clippy and `cargo fmt --check`
  passed. Mutation-checked: counting every pause as an underrun again fails the
  marks test (`left: 1, right: 0`), and restoring `cache-pause-wait=15` fails the
  read-back test (`left: 15.0, right: 8.0`). No JS change, so the Vite gate was
  unchanged; the release binary was rebuilt and the owner retests playback.

2026-10-17 direct-playback priority change (D-029, Package 1):
- Owner made avoiding the engine's four-second HLS packager the active playback
  milestone. The orchestrator measured 80 ms video gaps at every segment boundary
  on HLS and no video or audio timestamp gaps on the same direct file. This
  supersedes the previous trace-collection `Next task`. Starting tree was clean
  at `1cbf092`; the web checkout remained read-only.
- The load command now declares libmpv's containers, codecs and eight audio
  channels in one place instead of using WebKit's HTML media-element sniffer.
  A disposable 1280x720 HEVC MKV was generated with `ffmpeg`. The bundled
  engine v0.16.1 rejected a separate local HTTP URL with `blocked private
  address 127.0.0.1`; its own local archive stream served the same generated
  clip to `/hlsv2/probe`. That probe returned `format.name=matroska,webm` and
  `streams[0].codec=hevc`; the library's exact predicate returned old=false,
  native=true. The temporary engine and HTTP server were stopped and the
  disposable files removed. Other declared codec tokens have not been tested
  with generated variants.
- Subtitle audit: `WatchFlow` resolves external subtitle resources separately
  and `useStremioVideo` selects them through the native `player_select_subtitle`
  / `sub-add` path. Direct media still reaches mpv with embedded tracks, and
  native `track-list` events feed the library's `subtitlesTracks`; the app filters
  only `Locadora external` from that list. No dependency patch is needed for
  subtitle safety. However, `canPlayProbe` has two additional browser-specific
  HLS triggers, any embedded subtitle and two supported audio tracks. Those
  cannot be overridden by capability fields and remain a coverage limit.
- Package 1 check: `npm run check` passed, exit 0: TypeScript, Vitest 152
  tests/38 files, and Vite build (existing large-chunk advisory). No visual or
  real-stream playback check was performed.
- Next package removes only the temporary surface-probe instrumentation. Keep
  live geometry, fullscreen and the opt-in playback diagnostics/MARK untouched.

2026-10-17 surface-probe cleanup (Package 2):
- Removed the temporary frontend CSS/layout probe, native IPC command, bounded
  geometry logger, start/5s/15s samples, and draw/frame/bounds counters. Kept
  `VideoBounds` validation and margins, `last_real_bounds`, `layout`, GTK
  resize/tick/render wiring, fullscreen and Escape behavior. Also kept the
  delayed bounds remeasure calls: they retry real layout after a load or panel
  transition, so deleting them would change geometry behavior despite the
  request to remove probe settle timers. Only their diagnostic reason labels
  were removed. The opt-in playback timeline, MARK and Shift+M are untouched.
- `npm run check` passed, exit 0: TypeScript, Vitest 152 tests/38 files, Vite
  build. `cargo test --manifest-path crates/native-core/Cargo.toml --
  --test-threads=1` passed 22 tests, 0 failed; `cargo test --manifest-path
  src-tauri/Cargo.toml` passed 29 tests, 0 failed, 2 ignored. Both crates passed
  `cargo clippy --manifest-path <crate>/Cargo.toml --all-targets -- -D warnings`.
  Both crates passed `cargo fmt --manifest-path <crate>/Cargo.toml --check`
  after applying a Tauri line-wrap fix. `git diff --check` passed.
- `npm run tauri -- build --no-bundle` passed, exit 0; the optimized binary was
  refreshed after the final source edit. `find src src-tauri/src -type f -newer
  src-tauri/target/release/wills-locadora-player` printed nothing. No app
  launch, visual check, real stream, or 25-second playback timeline was tested.

2026-10-17 hiccup MARK (Package 4):
- Shift+M was chosen after checking the WatchFlow keyboard map (Escape,
  F/F11, Space, arrows and subtitle brackets) and Stremio ShellVideo. Plain
  M remains free for the conventional mute action. The loaded player sends a
  zero-argument `player_mark` command through the deny-by-default Tauri list;
  `MpvSession` writes a redacted, timestamped mark beside timeline samples
  and prints it once to stderr. When diagnostics are disabled, the mark prints
  using the already observed position, writes no file and issues no extra mpv
  request. The player has no transient confirmation pattern, so there is no
  visual MARK overlay or new user-facing copy.
- Fixed the final-review rotation off-by-one: rotation runs before the new
  file is created, so it now leaves room for exactly one new trace among the
  newest 20 files.
- `npm run check` passed TypeScript, 152 Vitest tests/38 files and Vite build;
  `cargo test --manifest-path crates/native-core/Cargo.toml --
  --test-threads=1` passed 22 tests; `cargo test --manifest-path
  src-tauri/Cargo.toml` passed 29 with 2 ignored. Both crates passed strict
  `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`;
  `git diff --check` passed. The native checks were rerun after the rotation
  fix. `npm run tauri -- build --no-bundle` first failed in sandbox at
  `spawnSync tar EPERM` during engine preparation; the approved outside-sandbox
  retry passed. The final rebuild after the rotation fix passed in 2m02s.
  `find src src-tauri/src -type f -newer
  src-tauri/target/release/wills-locadora-player` printed nothing. No app launch,
  manual visual check or real-stream playback was performed.

2026-10-17 playback diagnostics repair (Package 3):
- Starting tree was clean at `e128b92`; the separate web checkout stayed read-only.
  The two owner traces kept about 17 seconds, hid `hwdec-current` as `unknown`,
  and counted the initial cache fill as an underrun. D-028 records the evidence.
- The exact opt-in gate remains. One sample line per second now records decode
  method, pixel format, output/decoder/delayed counts, cache and FPS. Property
  errors and null data read `unavailable`; rejected values read `unknown`.
  A safe source line adds dimensions, codec and bitrate fields. The 2 MiB
  private file flushes during playback, retains marks/source/summaries through
  timeline eviction, and rotates the newest 20 files. Initial fill and later
  cache pauses have separate durations and counts.
- Generated 320x180 H.264/AAC local clips were read with `mpv --no-config
  --vo=null --ao=null`; listed properties and live values were confirmed for
  decode, pixel format, drops, delayed frames, cache, buffer, pause, time,
  estimated FPS, dimensions, format, codecs and audio bitrate. `video-bitrate`
  stayed `(unavailable)` on short generated MKV, MP4 and MPEG-TS probes; a
  subsequent 10-second CBR MPEG-PS probe returned real 745–776 kbps values.
  The null-output probe does not verify the embedded GLX decode choice.
- Mutation proof: mapping empty `hwdec-current` back to `unknown` failed
  `decode_method_and_unavailable_are_distinct` (exit 101); accepting arbitrary
  tokens failed `log_and_property_secrets_never_reach_file` on `token` (exit
  101). Both mutations were restored; the three diagnostics tests passed.
- Checks: `npm run check` passed TypeScript, 152 Vitest tests/38 files and Vite
  build (exit 0); `cargo test --manifest-path crates/native-core/Cargo.toml
  -- --test-threads=1` passed 22 tests; `cargo test --manifest-path
  src-tauri/Cargo.toml` passed 29 with 2 ignored; strict `cargo clippy
  --all-targets -- -D warnings` and `cargo fmt --check` passed for both crates;
  `git diff --check` passed. No app launch or visual/playback claim.

2026-10-17 playback-hiccup priority change:
- Owner moved the playback-hiccup investigation ahead of pending title-search
  visual acceptance, superseding the previous `Next task` and resuming the
  source-dependent investigation paused in D-024. Starting `git status --short`
  was empty at `4778f1d`. Two commits are planned: opt-in bounded/redacted
  diagnostics first, then the corrected copy-back-capable decode policy.
- The 2026-09-22 conclusion that `auto` retries copy-back was wrong. mpv 0.35.1
  documents a direct-method failure falling to software; the recorded trace
  showed about 13 output drops/s, zero decoder drops and no cache underrun.
  The prior `Not using this for auto-copy` line only filtered a direct method.
  A `vaapi-copy` null-output probe proves copy-back works here, not which method
  the embedded X11/GLX context selects. The new trace must settle that.
- Diagnostics package: only an exact `LOCADORA_PLAYBACK_DIAGNOSTICS=1` enables
  warning subscriptions and one-second IPC property reads during embedded
  playback. A 180-line ring is rewritten to one 64 KiB cache file per play;
  only the newest 20 playback files remain. mpv warning text is classified
  into fixed categories, and all property strings are strict allowlists or
  replaced with `unknown`, so URL/infohash/path/title bytes never enter the
  file or two `[locadora-video]` summaries. The default path has no channel,
  sampling, file or extra IPC. No media descriptor or member state is logged.
- Package-one checks: `npm run check` passed typecheck, Vitest 152/38, Vite
  build (existing chunk advisory), exit 0; `cargo test --manifest-path
  crates/native-core/Cargo.toml -- --test-threads=1` passed 20 tests (0 failed),
  including the redaction regression; `cargo test --manifest-path
  src-tauri/Cargo.toml` passed 29 tests (2 ignored); strict `cargo clippy
  --manifest-path <each Cargo.toml> --all-targets -- -D warnings`, both
  `cargo fmt --manifest-path <each Cargo.toml> --check`, and `git diff --check`
  passed. Native socket tests required an outside-sandbox retry after the
  initial in-sandbox run failed at `ControlUnavailable`. No GUI or real-stream
  playback was performed.
- Decode-policy package: embedded libmpv initializes with `auto-copy-safe`;
  the Stremio `auto-copy` set request translates to the same value, which the
  native property allowlist accepts as a closed choice. The existing libmpv
  option regression now reads back `hwdec` from the initialized handle. No
  render-loop, advanced-control, video-timing-offset, buffer, or `vd-lavc-dr`
  change was made. See D-027 for the diagnostic-gated timing follow-up.
- Package-two checks: `npm run check` passed typecheck, Vitest 152/38 and Vite
  build (existing chunk advisory), exit 0; `cargo test --manifest-path
  crates/native-core/Cargo.toml -- --test-threads=1` passed 20 tests;
  `cargo test --manifest-path src-tauri/Cargo.toml` passed 29 tests with 2
  ignored. Both crates passed strict `cargo clippy --all-targets -- -D
  warnings`, `cargo fmt --check`, and `git diff --check`. Mutating the
  diagnostic classifier to include raw mpv text made the redaction test fail
  on a token; restoring `hwdec=auto` made the libmpv read-back test fail
  (`auto` versus `auto-copy-safe`). Both source files were restored. Real
  stream behavior and the selected decode method remain unverified pending
  the owner retest.
- Final release proof: `npm run tauri -- build --no-bundle` passed (optimized
  profile 2m05s), refreshing
  `src-tauri/target/release/wills-locadora-player`; the preparatory `tsc -b &&
  vite build` also passed. `find src src-tauri/src -type f -newer
  src-tauri/target/release/wills-locadora-player` printed nothing. Final
  `git diff --check` passed. No manual GUI, playback, or real-source trace
  was available, so this is a measurable fix awaiting the owner's retest.

2026-10-10 title search priority change:
- The owner made a standalone title search the active task. Starting `git
  status --short` was empty. Normal 2D has a header "Buscar título" action;
  immersive mode has that action inside the existing "Buscar fitas" filter
  collapsible. The same `TitleSearch` modal submits on Enter or button press,
  reports loading/empty/error/result states, and hands selections to the
  existing title inspection callback. Search does not change shelf filters,
  rentals or playback.
- `searchTitles` calls the fixed public `/v1/search` route with a trimmed
  2–80-character query and `pt-BR`/`en-US` locale. The Tauri command accepts
  only those fields, validates them before encoding, and uses the same fixed
  Worker origin and bounded JSON transport as other public metadata calls.
  The pure `normalizeTitleSearch` caps to 12, checks canonical TMDB ids/type,
  bounds text and genres, accepts only TMDB HTTPS artwork, and returns
  `DiscoveryTitle`s for inspection. Search does not cache transient results;
  the inspector still loads full title details. See D-025.
- Focused `npm test -- test/titleSearch.test.tsx` passed 4 tests. Focused
  `npm test -- test/titleSearch.test.tsx test/app.test.tsx
  test/appTitleSearchImmersive.test.tsx` passed 18 tests/3 files. The first
  `npm run check` passed typecheck, 145 tests/37 files and Vite build with its
  pre-existing large-chunk advisory. A follow-up Unicode count/status wording
  edit is included in the final check now in progress.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D
  warnings` passed. `cargo fmt --manifest-path src-tauri/Cargo.toml` applied
  formatting. The first `cargo test --manifest-path src-tauri/Cargo.toml`
  passed 27 tests but the pre-existing bundled-engine lifecycle test could not
  bind its loopback port in the sandbox (2 ignored). An outside-sandbox retry
  of the exact command passed 28 tests, 0 failed, 2 opt-in ignored. No GUI,
  browser, live Worker response, or playback verification was performed.
- After the final Unicode count/status wording edit, `npm run check` passed
  typecheck, Vitest 145 tests/37 files (0 failed), and Vite production build
  (188 modules, 2.90s) with the existing large-chunk advisory. An overlapping
  attempt while the native release build was compiling hit timeouts in
  unrelated immersive/app/shelf tests and was stopped; the isolated rerun
  passed. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `git
  diff --check` passed. The first optimized build passed (2m48s) before the
  final UI wording edit. Final `npm run tauri -- build --no-bundle` passed
  (optimized profile 1m55s), refreshing
  `src-tauri/target/release/wills-locadora-player` with the final frontend.


2026-10-09 person-stand priority change and desktop port:
- The owner made person stands the active work. The source-dependent network-
  buffering investigation is paused with no new diagnosis; its previous
  live-source retest remains pending. Starting `git status --short` was empty.
- `/v1/title` credit ids normalize alongside legacy name arrays. The 3D tape
  back draws clickable person names with hit regions; the inspector also has
  keyboard-accessible credit chips and an on-demand crew panel. Old cached
  title details without ids display plain names. `PersonView` opens the fixed
  `/v1/person` route, groups returned job counts by department, and lists the
  first stand of titles below its role controls. `Ver como estante` selects a
  department stand; the existing 2D/immersive shelf paging path then requests
  `/v1/credit-stand` with `job=`, `type=all`, `ignoreStoreYear=true`, and
  `providers=`. Returning to the aisle restores the genre shelf. Empty results
  expose `Ver todos os streamings`, re-requesting the same unfiltered stand.
- A follow-up parity pass puts the person label and relevance/year/rating sort
  control on the immersive plaque as well as the 2D browse controls. Applying
  the plaque draft with Ir returns to the aisle, matching the web behavior.
- The desktop has no streaming-provider browse preference; no provider state is
  written by this flow. Sort is a local browse preference (`relevance`, `year`,
  `rating`) applied by Ir and sent to both shelf sources; changing browse
  filters leaves the person stand. Person and stand requests use fixed native
  Worker-origin commands and the existing browser public-API path. No member,
  player, add-on or web-repository file was changed. See D-024.
- Owner layout fix after the port: the browse sort field stretched across the
  whole grid column and pushed the row, so "Ordenar por" now shares the desktop
  row with genre and year, its select sized to the longest option (full width
  again only under 900px).
- Browse parity: the 3D plaque year field is now a dropdown like the genre (the
  vendored `web-scene/immersive-shelf.mjs` updated in lockstep with the web
  storefront commit `ece72e0`); it no longer opens a number input with spinners,
  keeps the all-years shortcut and the arrow stepping, and drops the old
  `input.select()` call a select element cannot honour.
- Cache: the catalogue cache keys are now versioned (`CACHE_VERSION` in
  `src/locadora/localCache.ts`, bumped to 2). Title detail records written before
  the credits block existed no longer match their key, so a tape inspected in an
  older build is re-fetched on its next inspection instead of being served
  without person ids - which is what made its credit names unclickable. The same
  bump invalidates pre-series shelf pages. Stale rows are pruned by the existing
  store limits.
- People search: the title-search panel gained a "Buscar pessoas" switch. With it
  on the same input queries `/v1/person-search` through the new fixed native
  `fetch_public_person_search` command, and the rows (portrait, name, department)
  open the existing `PersonView`. The payload is parsed by
  `src/locadora/personSearch.ts` under the same bounded rules as the title search
  (numeric ids, bounded name, TMDB-only portrait, department from the credit-stand
  allowlist with an `Acting` fallback, at most eight rows). The web storefront
  shipped the same route first (commit `894e2e4` there), so both clients share one
  contract.
- Checks: `npm run typecheck` passed; `npm test -- test/creditStands.test.tsx`
  initially found one incorrect legacy-name test expectation (the names are
  separate rows), corrected before the full run. `npm test --
  test/appCreditStand.test.tsx test/creditStands.test.tsx` passed 5 tests/2
  files. Final `npm run check` passed:
  typecheck; Vitest 139 passed/35 files, 0 failed; Vite production build passed
  with the existing large-chunk advisory. `cargo test --manifest-path
  src-tauri/Cargo.toml` passed 27 tests, 2 opt-in ignored. `cargo clippy
  --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo
  fmt --manifest-path src-tauri/Cargo.toml --check`, and `git diff --check`
  passed. `npm run tauri -- build --no-bundle` passed, refreshing
  `src-tauri/target/release/wills-locadora-player`. No
  GUI/browser, live Worker response, or playback verification was performed.
- Follow-up static checks: `npm run typecheck` passed; `npm test --
  test/immersiveAdapter.test.tsx test/immersiveScene.test.ts` passed 2 tests/2
  files. Final `npm run check` passed typecheck, 139 tests/35 files (0 failed),
  and Vite production build with the existing large-chunk advisory. Final
  `npm run tauri -- build --no-bundle` passed (optimized native build 1m26s)
  and refreshed `src-tauri/target/release/wills-locadora-player`. No
  GUI/browser or live Worker response was exercised.

2026-10-06 network-buffering follow-up:
- User suspects connection speed and requests buffering comparable to Stremio.
  Existing mpv policy resumed after only five seconds. Shared native policy now
  targets 15 seconds before starting/resuming, 120 seconds read-ahead with
  explicit cache-secs, and 256 MiB forward / 32 MiB backward ceilings. mpv owns
  cache pauses; user pause is not overridden. See D-023 for limits/tradeoff.
- Added a localized recovery overlay for already-loaded video/fullscreen;
  it clears on recovery or user pause. No member-state or web changes.
- Compared official Stremio shell defaults and the bundled Go engine's adaptive
  torrent read-ahead (8–64 MiB); these engines differ. No failing-source trace
  was captured and no universal root-cause or live playback claim is made.
- `npm run check -- --maxWorkers=4` passed (typecheck, 134 tests/33 files,
  production build; the flag applied to the build script, tests used defaults).
  `cargo test --manifest-path crates/native-core/Cargo.toml -- --test-threads=1`
  passed 19 tests, including live-libmpv reads of the new cache settings.
  `cargo clippy --manifest-path crates/native-core/Cargo.toml --all-targets --
  -D warnings` passed; core Cargo fmt and `git diff --check` passed.
  UI regression covers fullscreen buffering, recovery and manual pause.
  `cargo test --manifest-path src-tauri/Cargo.toml` passed 26 tests (2 opt-in
  ignored). Both Cargo fmt checks passed. `npm run tauri -- build --no-bundle`
  passed (optimized native build 1m50s); refreshed
  `src-tauri/target/release/wills-locadora-player`. Existing bundle-size advisory
  remains. No GUI/browser testing performed.

2026-10-06 completed 2D UI milestone:
- User prefers desktop normal-mode colors/layout for the web. Web commit
  `b03d490` adds scoped `public/normal-mode.css`, navy/brighter brand palette,
  labelled header actions, header Cesta/immersive button and app shelf spacing.
  Immersive/Counter scene CSS is unchanged. Removed web header catalogue search;
  its separate Counter search remains. Desktop shelf filtering/search input,
  query state and dead translation/CSS entries are removed.
- Desktop UI commit `67ebd31`; web commit `b03d490` pushed and GitHub Pages
  run `37549045891` succeeded. Live HTTP 200 HTML references normal-mode.css,
  omits header search, and CSS serves desktop navy #172c49. Release worktree
  web layout tests: 44 passed; production build passed.

2026-10-06 separate playback-hiccup investigation:
- User explicitly clarified that playback hiccups are an independent issue.
  Timing correction committed separately as `352d318`.
- User reports short source-dependent video/audio interruptions. No live
  player socket accepted a diagnostic connection; there is no failing-source
  sample. Asked whether the buffering indicator accompanies interruptions;
  no answer yet. Do not claim a confirmed source-specific diagnosis.
- Found an independent native timing defect: `render()` passes
  MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME=0 but initialization retained mpv's
  early-video offset. Installed `/usr/include/mpv/render.h` and upstream render.h
  explicitly require honoring the target time or setting video-timing-offset=0.
  Embedded player now sets the latter, preserving nonblocking GTK rendering and
  audio-master defaults. A real-libmpv regression reads back the initialized
  option. A separate no-media libmpv ABI probe confirmed the previous default
  is 0.05 seconds (50 ms); the regression confirms the corrected value is zero.
  No speculative cache/decoder/audio-buffer changes were made.
- Checks: `npm run typecheck` passed; `npm test -- --maxWorkers=4
  --testTimeout=15000`: 133 passed/33 files. Web `npm test`: 275 passed;
  `npm run build:pages` passed. `cargo test --manifest-path
  crates/native-core/Cargo.toml nonblocking_renderer_disables_early_frame_presentation`
  passed; `cargo test --manifest-path crates/native-core/Cargo.toml --
  --test-threads=1` passed 19 tests. `cargo test --manifest-path
  src-tauri/Cargo.toml`: 26 passed, 2 opt-in ignored. Strict Tauri Clippy and both
  Cargo fmt checks passed. `npm run tauri -- build --no-bundle` passed, optimized
  build 2m27s; release executable refreshed with both independent commits.
  Existing bundle-size advisory remains. No browser/GUI/manual checks performed.

2026-10-06 deployment follow-up:
- User confirmed manually applying the rental-limit SQL migration, then authorized
  Worker/web deployment. No production SQL was executed by the agent.
- Deployed only committed web revision `2d7493b` from isolated worktree
  `/tmp/locadora-rental-release`, preserving unrelated uncommitted web/TV work.
  `npx wrangler deploy` from its `workers/locadora-data` succeeded; version
  `18f7a0a3-1692-415f-b21c-d6cd595f2d84`.
- `git push origin main` published `2d7493b`; GitHub Pages run `37479738583`
  completed successfully. Isolated release checks: `node --test
  test/locadora-data-worker.test.mjs test/app-core.test.js` passed 65 tests;
  `npm run build:pages` passed.
- Live HTTP verification: website HTML and app.js return 200 and include the
  rental selector, `/v1/rental-limit` save handler, and three-title previews.
  Unauthenticated PUT `/v1/rental-limit` returns 401 Authentication required.
  No account state was changed; signed-in save and fullscreen visual acceptance
  remain user checks. Desktop release remains the successfully rebuilt version.

2026-10-06 fullscreen and membership changes:
- Completed the previously staged native composition correction: black base ->
  native GLArea -> transparent WebView; fullscreen uses the full native viewport
  independently of controls/drawers, with mode-tagged windowed bounds on exit.
  This correction had not previously reached the release executable.
- Carteirinha now previews at most three watch-later/favorite entries. Dedicated
  list views retain every normalized entry and tape inspection actions.
- Account rental limits are integers 1–10, default 3. The desktop uses the
  confirmed profile value, refreshes it at checkout, permits up to ten staged
  tapes, and retains ten active records even after a limit reduction. Added
  fixed native `member_update_rental_limit` -> PUT `/v1/rental-limit`.
- User explicitly expanded scope to the web/backend checkout, including its
  account UI. Changes there preserve unrelated uncommitted work. Web and desktop
  share `profile.rentalLimit`; SQL locks the profile during rental creation.
- Migration: `../locadora/supabase/migrations/20261006_member_rental_limit.sql`.
  User applies production migrations manually in the SQL editor; do not apply it
  remotely. Production migration and web/Worker deployment remain pending.
- Checks: `npm run typecheck` passed; `npm test -- --maxWorkers=4
  --testTimeout=15000` passed 134 tests/33 files. `cargo test --manifest-path
  src-tauri/Cargo.toml` passed 26 tests, 2 opt-in ignored after rerunning with
  local socket access (sandbox denied engine/mpv control sockets).
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  passed; `cargo fmt --manifest-path src-tauri/Cargo.toml` applied formatting;
  diff whitespace checks passed. Web `npm test`: 276 passed; web
  `npm run build:pages`: passed. New SQL migration and `test/member-rental-limit.sql`
  passed in an isolated temporary PostgreSQL 18 database after the core schema.
  Final web Worker check `node --test test/locadora-data-worker.test.mjs`:
  39 passed. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed.
  `npm run tauri -- build --no-bundle` passed (optimized build 1m26s), refreshing
  `src-tauri/target/release/wills-locadora-player`; existing chunk-size advisory
  remains. Web changes committed as `2d7493b`, preserving all prior web/TV work.
  No browser/GUI/manual playback acceptance was performed.

2026-09-29 native composition correction after repeated fullscreen failures:
- Previous geometry and state fixes did not resolve the rendering boundary:
  GLArea painted above the WebView, requiring asynchronous bounds reports to
  keep every HTML control clear of the movie. Replaced that arrangement with
  an opaque black GTK base, native video, and the transparent WebView on top.
  Source/subtitle menus and controls can now paint above the picture.
- React owns transparency only while Watch is mounted. The catalogue is hidden
  beneath playback, loading artwork clears when video loads, and normal page
  backgrounds return on close. Renamed the Stremio shim capability to
  `appOwnsVideoBackground`; it still blocks upstream ancestor mutation.
- Fullscreen uses the complete native surface at all times. The compact dock
  and bounded right drawer overlay it without resizing the picture. Windowed
  playback retains its measured frame. Mode-tagged bounds reject a fullscreen
  rectangle on exit; native window state ignores stale windowed bounds on
  entry. Double-click now toggles fullscreen in both directions.
- Regression coverage includes viewport geometry during stale/zero reports,
  repeated native transitions and scaling, actual CSS transparency/stacking,
  player mount/unmount cleanup and double-click exit.
- Checks: `npm run typecheck` passed; `cargo test --manifest-path
  src-tauri/Cargo.toml` passed (26 tests, 2 opt-in ignored); `cargo clippy
  --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` and
  `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed.
  `npm run check` stopped at a 5-second timeout in the saved-title UI test
  (127 passed); `npm test -- --maxWorkers=4` stopped at the same timeout in
  the immersive catalogue test (127 passed). Both failures were timing limits,
  with no failed assertions. `npm test -- --maxWorkers=4 --testTimeout=15000`
  passed all 128 tests across 33 files. `git diff --check` passed.
  Native release rebuild pending. No GUI/manual playback verification performed.

2026-09-29 fullscreen follow-up after user reported continuing bugs:
- The preceding geometry refresh did not address source loading resetting
  React's fullscreen flag while GTK remained fullscreen. `useStremioVideo.load`
  now preserves the window's state across source selection, failures and retry.
  Native renderer release also leaves the window state intact so Escape remains
  available after renderer replacement.
- Entering fullscreen could retain the hover flag from its windowed button,
  preventing idle auto-hide and permanently reserving control space. Reset that
  flag before scheduling the fullscreen idle timer. Leaving the player also
  clears hover and restarts the timer. Keyboard focus and open panels continue
  to retain controls.
- Pin the watch dialog explicitly to the viewport with fixed positioning,
  zero inset and zero margin. GTK's GLArea now queues a redraw on resize even
  when playback is paused/buffering and no new mpv frame arrives.
- Added three interaction regressions; each failed before the changes and
  passed afterward. `npm test -- test/watchFlow.test.tsx
  test/useStremioVideo.test.tsx test/playerPresentation.test.ts`: 24 passed.
  `npm run check`: 124 tests across 32 files, typecheck and production build
  passed. `cargo test --manifest-path src-tauri/Cargo.toml
  embedded_surface::tests`: 2 passed; `cargo fmt --manifest-path
  src-tauri/Cargo.toml --check`: passed. `cargo clippy --manifest-path
  src-tauri/Cargo.toml --all-targets -- -D warnings`: passed.
  `npm run tauri -- build --no-bundle`: passed (optimized build 2m09s),
  refreshing `src-tauri/target/release/wills-locadora-player` used by `locadora`.
  Existing bundle-size advisory remains. `git diff --check`: passed.
  No GUI/browser/manual playback validation performed.

2026-09-29 fullscreen geometry correction:
- User reported that the fullscreen picture retained windowed-player space and
  that the source/subtitle panels could appear below the movie. The player now
  has explicit windowed, fullscreen-controls, fullscreen-panel and
  fullscreen-idle presentation states. Idle fullscreen gives the measured
  video frame the entire window; visible controls reserve only their compact
  bottom strip.
- Entering fullscreen closes a panel inherited from the windowed layout. A
  panel deliberately opened in fullscreen stays beside the picture as a
  bounded right drawer at every responsive breakpoint; the narrow-window rule
  can no longer move it below the movie.
- Every fullscreen, panel and control-visibility transition now explicitly
  refreshes the app-owned `.cinema-screen` bounds immediately and during three
  short settling passes. This replaces reliance on an incidental browser
  resize event and prevents a previous windowed rectangle from surviving a
  native fullscreen transition. The GTK GLArea remains above the WebView, so
  visible HTML controls continue to reserve space rather than overlay video.
- Checks: `npm run check` passed (121 tests across 32 files, typecheck and
  production build). The focused player run passed 21 tests across
  `watchFlow`, `useStremioVideo` and `playerPresentation` before the full suite.
  `npm run tauri -- build --no-bundle` passed (optimized build 1m24s), refreshing
  `src-tauri/target/release/wills-locadora-player`. Existing large-chunk advice
  remains. `git diff --check` passed. No GUI/manual playback testing performed.


2026-09-28 Carteirinha/saved-list inspection:
- User changes priority to opening tape inspection by clicking a list title.
  Active rentals, watch-later, favorites and return history now use accessible
  title buttons. Carteirinha now shows its previously missing favorites section
  and all normalized watch-later entries instead of only the first five.
- `SidePanel` passes the shared inspection callback to `MemberPanel` and
  `SavedPanel`; `App` dismisses the list panel and opens its existing inspection,
  including asynchronous title details, Watch and Cesta/rental actions. No
  overlapping modal remains above inspection.
- Shared `memberDiscoveryTitle` in `src/member/memberState.ts` bridges records by
  their TMDB ID/type, never rental-item IDs. Remote/local saved lists use the same
  conversion. Inspection clicks never return a rental, mark it watched, remove
  a saved title or submit a review; those actions keep separate controls.
- Checks: `npm run typecheck` passed; `npm test -- test/memberPanel.test.tsx
  test/app.test.tsx test/memberState.test.ts` passed (20 tests across 3 files).
  Coverage includes all account lists, the sixth watch-later item, keyboard
  activation, canonical identity, no return/review write on inspect, and saved/
  favorite inspection through adding to Cesta. `git diff --check` passed.
  Native rebuild pending. No GUI/manual/live member-data testing performed.
- Existing tape-cover CSS removal and untracked presentation test remain
  outside this milestone.


2026-09-28 fullscreen refinement and web immersive scene port:
- User changes priority to subtle fullscreen chrome and an immersive view that
  completely replaces 2D. Fullscreen now omits the title header and routine
  phase/buffer row, with a slim black transport strip, smaller neutral icons,
  thin timeline and icon-only secondary controls. Activity auto-hide remains;
  sources, tracks, failure feedback and Escape remain available. Its fullscreen
  button now exits as well as enters. Native GLArea still reserves control space
  because WebView controls cannot paint above the native surface.
- `App.tsx` mounts either the normal shelf/footer or the full-window immersive
  room. A compact corner menu keeps account, saved, Cesta, settings, 2D return
  and keyboard-friendly catalogue controls accessible. Each immersive stand is
  its own catalogue page; navigation uses cached pages and fetches another only
  at the end. WebGL initialization failure/context loss returns to normal 2D.
- Replaced the simplified labelled-box scene with a local MIT port of the
  reference web `immersive-shelf.mjs` and `vhs-case.mjs`, including their license:
  `src/locadora/web-scene/`. Preserves web room/rack geometry, VHS cases/spines,
  lamps, wall posters, floor, plaque, camera framing, selection and zoom/gesture
  behavior. Reference repo was read/copied only, never modified.
- `ImmersiveShelf.tsx` is the typed React adapter. It loads canvas-safe artwork
  with four workers through the existing cache/native boundary; each case is
  updated as its blob arrives. Original canonical identities reach inspection;
  disposal revokes URLs and ignores late results. Rendering pauses behind
  playback and dialogs. Decorative posters use this stand's movie covers rather
  than requesting the web-only featured endpoint. No provider controls added.
- Tests: `npm run check` passed (116 tests in 31 files, typecheck, production
  build); `npm test -- test/immersiveAdapter.test.tsx test/immersiveScene.test.ts`
  then passed 2 tests including an additional lifecycle test and actual scene
  render callback using a mocked GPU. `node --check` passed for both copied scene
  modules; `git diff --check` passed. Existing large-chunk warning remains.
  Final `npm run typecheck` passed. `npm run tauri -- build --no-bundle`
  passed (optimized build 1m46s), refreshing
  `src-tauri/target/release/wills-locadora-player`. Close/reopen `locadora` to
  use the new build. `git diff --cached --check` passed.
  No GUI/browser/manual acceptance performed.
- Pre-existing `.case-art::after` removal and untracked
  `test/playerPresentation.test.ts` remain outside this milestone.


2026-09-28 resolution filter and windowed/fullscreen correction:
- Found the concrete geometry mutation: official `withHTMLSubtitles.js` sets
  `containerElement.style.position = 'relative'`, overriding React's absolute
  host style and collapsing its auto height. `useStremioVideo.viewportRef` now
  measures/observes the app-owned `.cinema-screen`; Stremio only owns the inner
  host, which also has explicit full width/height. A hook regression reproduces
  the zero-height inner host and checks visible outer-frame bounds and unload.
- Native layout now uses that rectangle in both windowed and fullscreen modes,
  always passes pointer input to the WebView, and honors explicit hide reports.
  Fullscreen controls appear on pointer movement/keyboard activity and hide after
  three idle seconds; pause, open options, control hover and keyboard focus keep
  them available. The native picture resizes to reserve visible chrome space;
  controls are not composited transparently over GLArea. Escape still exits.
- Fontes has a resolution select (all, available resolutions, unknown) and
  descending seed counts, unknown seeds last. Sorting is manual-picker-only;
  Quick Watch tiers stay intact. Numeric structured resolutions are now parsed
  instead of silently becoming unknown. Synthetic filter and interaction tests
  cover filtering, source switch, inactivity and option-panel retention.
- Preserved prior uncommitted presentation/diagnostic work. Temporary probes
  remain bounded and descriptor-free until user confirms windowed rendering.
- Checks: `npm run check` passed (113 tests, 29 files, typecheck and build).
  `cargo test --manifest-path src-tauri/Cargo.toml`: 25 passed, 2 opt-in ignored.
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passed. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed.
  After the focus/hover refinement, `npm test -- test/watchFlow.test.tsx
  test/useStremioVideo.test.tsx test/sourcePicker.test.ts`: 17 passed.
  `npm run tauri -- build --no-bundle`: passed (optimized Rust build 1m30s),
  refreshing `src-tauri/target/release/wills-locadora-player`; close/reopen the
  existing `locadora` launcher to load this build. Typecheck/production assets
  rebuilt by Tauri; existing large-chunk advisory remains. `git diff --check`
  and `git diff --cached --check` passed.
  Prior tape-cover CSS removal and its existing presentation-test file are left
  outside this milestone commit; related earlier player work is included.
  No GUI/browser/manual playback checks performed.


2026-09-28 user playback failure supersedes the peer-transfer test priority:
`Could not initialize embedded mpv`. The installed libmpv returns NULL from
`mpv_create()` under `en_US.UTF-8`, but succeeds under `C`. Its installed
`/usr/include/mpv/client.h` explicitly requires LC_NUMERIC=C. GTK normally
sets LC_ALL from the user's environment, whereas previous headless Rust tests
left the C-runtime locale at its default. This explains the missed integration
case; the generic surface error also hid the underlying startup stage.

`src-tauri/src/native_locale.rs` now initializes the user's locale once at entry,
resets only LC_NUMERIC to C and calls gtk_disable_setlocale before GTK startup,
preventing GTK from undoing the correction. No per-playback/global locale race
is introduced; other locale categories remain unchanged. The surface now retains
the safe typed PlayerError in its startup message. A subprocess regression first
reproduces rejection, then verifies handle creation and an actual embedded
MpvSession/control channel after correction. C.UTF-8 is accepted by this libmpv,
so the regression intentionally uses installed en_US.UTF-8 instead.

Verification for the locale fix:
- `npm run check`: 106 tests passed (27 files), typecheck/build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 25 passed, 2 opt-in ignored,
  including the isolated non-C locale regression and embedded session startup.
- `cargo test --manifest-path crates/native-core/Cargo.toml -- --test-threads=1`:
  18 passed, including native playback/subtitle IPC tests.
- Strict Tauri Clippy, `cargo fmt --check` and `git diff --check` passed.
- `npm run tauri -- build`: passed (optimized Rust build 1m51s); release executable
  and Debian installer refreshed after fix commit `5049907`. Existing `locadora`
  alias runs the corrected executable after closing/reopening any old instance.
  No GUI/real-movie acceptance claimed.

2026-09-28 player-presentation checkpoint (native overlay vs. WebView backdrop):
four fixes were built into the release executable for the user's picture check.
(1) `tools/shellOverlayShim.ts` (Vite `enforce: 'pre'` transform) stops official
Stremio Video's `setBackground(false)` from making the video container's
ancestor transparent, but only when the shell transport advertises the new
`nativeVideoOverlay: true` capability — Locadora paints mpv ABOVE the WebView, so
the upstream backdrop-mutation contract would otherwise blank the picture.
(2) `src/media/videoBounds.ts` reports a clipped-but-visible rectangle instead of
hiding the whole surface as soon as any edge passed the viewport by a fraction
of a pixel. (3) The loading placeholder now uses the hero wordmark
(`.brand-logo`) with a slow pulse, disabled under `prefers-reduced-motion`.
(4) The inset cover frame (`.case-art::after`) was removed from the 2D tape art.
`src-tauri/src/embedded_surface.rs` also emits ONE bounded `[locadora-video]`
line 5s after startup (`visible/mapped/bounds-visible/size/draws/frame-updates`)
to separate a hidden surface from a drawing failure. No request headers, URLs or
session material are logged, and mpv log forwarding stays off.

Test-infrastructure correction: `styles.css?raw` returned an empty string under
Vitest's default CSS stubbing, so `test/playerPresentation.test.ts`'s stylesheet
guard passed vacuously. `vite.config.ts` now imports `defineConfig` from
`vitest/config` and sets `test.css: true`, which makes `?raw` return the real
41 KB stylesheet and keeps the assertion meaningful.

Verification for this checkpoint: `npm run check` passed (28 files, 109 tests,
typecheck, production build). `npm run tauri -- build --no-bundle` passed and
refreshed `src-tauri/target/release/wills-locadora-player`, 35,755,888 bytes,
2026-09-28 08:22:18 -0300, SHA-256
`633f2b807bdd2e24e8c4b78e206cda0c2b34780f345f2c74e6e27dd8ed5b6105`, the target of
the user's `locadora` alias. Only the Rust `[locadora-video]` literal is greppable
in that binary: Tauri compresses embedded frontend assets, so binary grep cannot
confirm frontend markers — compare `dist/` timestamps against the executable
instead. No GUI, playback or visual acceptance is claimed; the user rechecks.

2026-09-28 windowed-playback checkpoint (user-confirmed fullscreen playback):
the user reported that embedded playback works, but ONLY in fullscreen. That
confirms the whole render chain (mpv, GTK GLArea, GL, mpv render API and the
native bounds plumbing) and isolates the fault to the windowed visibility gate:
`Surface::layout` showed the area only when `fullscreen || bounds.visible`, and
the WebView reported a degenerate rectangle (`offsetHeight 0` with a 573 px
parent) right when the stream load dispatched, so the native surface stayed
hidden with audio, seek and buffering all advancing.

Native fix: the surface now keeps `last_real_bounds` (the most recent report
that actually carried a width and height) and uses it for margins, and only a
report with a real rectangle may change `requested_visible`. A zero-sized layout
pass can no longer hide the video. The windowed recheck is pending; the frontend
also gained a bounded hold/retry for the same measurement (never report a
degenerate rectangle while the player wants the surface visible, plus
re-measures at 150/400/900/2000 ms after load).

Temporary diagnostics still in the tree (remove once windowed playback is
confirmed): the `player_surface_probe` command (character- and length-allowlisted,
shared 12-line budget), the bounds/transition logging, the 5 s and 15 s samples,
the inline `position/inset` lock on the surface div, and the frontend probe that
reports the measured element plus the height-annotated ancestor chain.

Player chrome (user request: too crowded, double border plus a black gap):
the watch modal now fills the window (`100vw/100dvh`, no border, no radius, no
shadow, opaque `::backdrop`), so the OS window frame is the only frame and the
inset ring that showed the app header behind it is gone. The header row lost its
`WILL'S LOCADORA / EM CARTAZ` breadcrumb and the year/resolution badge, and is
slimmer; the transport dock is unchanged for now. Auto-hiding controls were
deliberately NOT implemented: mpv paints above the WebView, so HTML drawn over
the video area is invisible and any overlay design must resize the native
surface instead.

Verification for this checkpoint: `npm run check` passed (28 files, 109 tests,
typecheck, production build); `cargo clippy --manifest-path src-tauri/Cargo.toml
--all-targets -- -D warnings` and `cargo fmt --check` passed; `npm run tauri --
build --no-bundle` passed and refreshed
`src-tauri/target/release/wills-locadora-player` (35,791,400 bytes, 2026-09-28
10:37:26 -0300, SHA-256
`f780831ffa747049265459338a8725318f62687757258db45800c17bee08d991`), the target of
the user's `locadora` alias; `git diff --check` passed. Fullscreen playback is a
user report; windowed playback is NOT yet confirmed.

Current priority: ship Locadora as a single-install standalone app with its own
managed compatible streaming engine (D-018), and redesign its embedded player with modern
streaming-style controls and Locadora borders. Read
`docs/STANDALONE_PLAYER_PLAN.md` for the approved scope, code map, ordered
milestones and acceptance criteria. D-016 supersedes the external-service-only
delivery boundary; D-017 defines the player redesign.

2026-09-27 player implementation checkpoint: milestone 3 now has a window-fitted
cinema layout, restrained dark blue borders, compact title/back header, consistent
SVG transport controls, played/buffered seek bar, official Stremio volume/mute,
and separate source/audio/subtitle panels. Panels resize the native video area
rather than overlaying it; smaller windows stack the options below the picture.
Subtitle delay stays in the selected-track panel. Escape first leaves fullscreen
or closes options (restoring focus) before dismissing playback. Replay, retry,
cancellation and source switching remain available; playback still does not touch
Locadora member state. Main files: `src/components/WatchFlow.tsx`, `PlayerIcon.tsx`,
`src/media/useStremioVideo.ts`, `src/styles.css`; shared Modal gained an optional
cancel handler without changing other modal defaults.

`npm run check` passed (26 files, 102 tests, production build). After the final
focus/volume-input refinement, `npm run typecheck` and `npm test --
test/watchFlow.test.tsx test/useStremioVideo.test.tsx` passed (11 tests).
`npm run tauri -- build --no-bundle` passed (native release build 1m17s), refreshing
`src-tauri/target/release/wills-locadora-player` at 2026-09-27 08:47:06 -0300
(28,013,760 bytes). The existing `locadora` alias targets this executable.
`git diff --check` passed. The build still reports the existing large JS chunk
warning. No GUI/browser/manual playback testing was performed or claimed.

Historical pre-D-018 checkpoint: standalone milestones 1/2/4 were incomplete. The official server's
redistribution terms were not established; no engine has been added. A concrete
unofficial MIT candidate is recorded in `docs/STREAMING_ENGINE_FINDINGS.md` for
evaluation, not as an adopted dependency. The user has been asked to choose the
official-permission route or compatible-engine evaluation; no explicit choice
has been received at this checkpoint.

2026-09-27 documentation checkpoint: consolidated the new direction and corrected
stale authorization, separate-window and service-dependency guidance. No runtime
code, engine packaging or player redesign was implemented in this checkpoint;
no executable was rebuilt. Earlier verification entries below remain historical.

The architecture has been corrected to reuse Stremio rather than reproduce it.
Official `stremio-core` is pinned at revision
`b3062f7fa790223540022f9a62c12067b646c179`. It now owns manifest parsing,
resource compatibility, request construction, and typed stream/subtitle
response parsing. Official `@stremio/stremio-video` 0.0.98 now owns frontend
player state and coordination through its ShellVideo implementation. The
handwritten TypeScript add-on client, native resource URL builder, and custom
player reducer were removed. The native environment supplies bounded HTTPS and
a deny-by-default mpv adapter while private transport URLs remain in the OS
credential store.

The first Phase 2 slice now calls the existing Better Auth and private Worker
contracts through the bounded native HTTPS transport. Locadora bearer material
is stored in its own OS-keyring service/account and is never returned to React.
The account panel supports participation-time sign-in, session restoration,
sign-out, and normalized profile, active-rental, saved-title, favorite, and
history summaries. Anonymous browsing and all media configuration remain
independent.

Desktop account creation now uses the existing Better Auth email-signup
contract with a fixed, already trusted public Locadora verification callback.
The account panel collects confirmation locally and completes the separate
private `PUT /v1/profile` username-onboarding flow. Callback selection remains
native-allowlisted and session material never reaches React.

The existing “Salvos” panel now combines bounded account collections with
anonymous device-local saves. Tape inspection can add/remove `watch_later` and
`favorite`; authenticated writes use only fixed native Worker routes, while a
missing/unavailable member session leaves the local choice intact. Collection
writes do not touch Cesta, rental, or player state.

The existing Cesta/Balcão flow now remains anonymous while titles are staged,
then requires a signed-in member with a completed public profile at checkout.
It submits one to three distinct canonical snapshots through the fixed native
`POST /v1/rentals` route, refreshes member state after success, and clears only
the Cesta. No playback event participates in the rental transition.

The account return desk now requires one explicit existing outcome—watched, not
watched, or undisclosed—before calling a fixed native
`POST /v1/rental-items/:id/return` route. Rental item IDs must be UUIDs. A
successful return reloads active rentals and history; no player event can
trigger or choose the outcome.

Account history now paginates through a fixed native
`GET /v1/history?offset=N` route. Offsets are integer-bounded to 10,000, every
page is normalized independently, entries are deduplicated by rental-item ID,
and the UI stops requesting pages when the Worker clears `hasMore`.

Title inspection now opens bounded public review summaries/cards through the
fixed title route. Signed-in eligibility is checked separately, and only an
eligible member can submit a half-star rating plus 1–1,000 characters through
the fixed review route. Review state is attached only to the canonical Locadora
title and never to a media source or playback event.

Voluntary support now uses the same intentionally public Pix copy-and-paste
payload as the Locadora website in a standalone footer modal. It has no payment
API, confirmation, persistence, analytics, or relationship to Cesta, rentals,
returns, reviews, member/media sessions, or playback. Phase 2 implementation is
complete; its exit criteria still need a live user-session acceptance check.

The media settings panel can now import the complete add-on collection from an
installed official Stremio Flatpak or native Linux desktop installation. The
reader targets only the exact add-on record, never reads cookies or authKey,
and uses a read-only LevelDB parser that does not lock or mutate Stremio data.
All safe manifests are validated through the existing native boundary and
stored in Locadora's separate OS-keyring entry. Catalog-only add-ons remain
visible for collection parity without exposing Stremio catalogue routes.

The optimized desktop build now mounts its interface. A release-only startup
crash came from `vtt.js`, the WebVTT parser required by Stremio Video: its
script-style files publish their API through a top-level `this`, which the
production bundler substitutes as `undefined`, so evaluating the bundle threw
`Cannot set properties of undefined (setting 'WebVTT')` and the window stayed
empty while the stylesheet alone painted the page background. A build-time shim
(`tools/vttGlobalShim.ts`) now hands those UMD footers the real global instead
of patching the dependency on disk. Relative Vite asset URLs were kept as
portability for Tauri's asset origin, but absolute paths were already resolving
there; they were not the cause of the blank window.

Next task: owner runs the rebuilt binary on a single-audio MKV source without
embedded subtitles, confirms the live mpv `file-format` is a container rather
than `hls`, and supplies a 25-second timeline for zero-gap/zero-duplicate
comparison. A separate embedded-subtitle or multi-audio source should establish
the remaining HLS coverage limit before any library adaptation is approved.

2026-09-28 delivery checkpoint (artifacts built 2026-09-27 11:15 -0300):
- Commits: `8037ff9` pins/stages the engine; `dece2af` implements its lifecycle,
  native metadata bridge, tests and Debian packaging.
- `npm run tauri -- build`: passed, optimized native compilation and one Debian
  bundle. Initial sandbox run could not spawn the extraction tool; approved
  outside-sandbox retry succeeded. No GUI or installer was launched.
- Executable: `src-tauri/target/release/wills-locadora-player`, 35,756,592 bytes.
  Existing `locadora` alias targets this file; no alias change is needed.
  SHA-256: `92bf6841518b92a6625c4f1d99a7c5f5bd89f076f82b33fbe138fe7415c0ee17`.
- Installer: `src-tauri/target/release/bundle/deb/Will's Locadora_0.1.0_amd64.deb`,
  17,629,396 bytes; SHA-256
  `560dc108589c04313a660ce5cf6d7ede51790fdbfe329a8d664d55539283a973`.
- `dpkg-deb --field` verified package `will-s-locadora`, version `0.1.0`, amd64,
  dependencies `libmpv2, mpv, ffmpeg, libepoxy0, libwebkit2gtk-4.1-0, libgtk-3-0`.
  `dpkg-deb --contents` verified executable, desktop entry and icon.
- Binary byte inspection verified embedded engine, LICENSE, provenance and SBOM.
  Package executable differs from the release executable only at three bytes:
  Tauri's bundle-type marker changes `UNK` to `DEB`. Packaged executable SHA-256:
  `745786dfc677e54770a586af519102184b79990dad5e73c2c26a4a7557aa5cdd`.
- `ldd` resolved the local native libraries with no missing dependency reported.
  This is not a clean-machine installation test.
- Strict Clippy and formatting checks passed for both Rust manifests. No code
  changed after the full suites recorded below; this checkpoint is documentation.

2026-09-27 standalone integration: `streaming_engine.rs` now owns an embedded
v0.16.1 process on port 11471, with private sessions, serialized/bounded readiness,
port conflict refusal, crash-retry restart, parent-death signal and exit cleanup.
Official Stremio Video calls native ensure for torrents; direct HTTPS bypasses
startup. CSP and native loopback validation agree. No external service fallback.
Engine pieces use a 256 MiB RAM cache; no persistent movie library is downloaded.
The synthetic engine test exposed upstream rejection of Tauri's non-HTTP origin.
`stremioService.ts` now bridges only the fixed owned-engine origin through
`streaming_engine_request`: allowlisted metadata/create endpoints, bounded
requests/responses, validated nested torrent URLs, no redirects or generic proxy.
No wildcard CORS was enabled. A dedicated spawn thread stays alive for the child:
Linux parent-death signals follow the spawning thread, which must not be an
idle-retiring async worker. The runtime uses official Core/Video unchanged.

Final integration verification (2026-09-27):
- `npm run check`: 27 files, 106 tests passed; typecheck and production build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 24 passed, 2 opt-in ignored.
  Includes actual embedded engine startup, synthetic empty-torrent metadata,
  official Video create shape/file selection, hostile-origin rejection, occupied
  port preservation, start reuse, crash restart, shutdown and session cleanup.
  Local-socket tests required approved execution outside the sandbox.
- `cargo test --manifest-path crates/native-core/Cargo.toml -- --test-threads=1`:
  18 passed, including mpv IPC and subtitles. One intermediate compile failure
  from a misplaced test fixture was corrected before this successful run.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passed; both Cargo manifests formatted; `git diff --check` passed.
- GUI, real peer transfer, audible playback and clean-machine install have NOT
  been exercised. Synthetic metadata tests are not real movie-playback proof.

2026-09-26 GTK crash fix: opening tape inspection exposed an incompatibility
between Tauri 2.11's unconditional Linux undecorated-resize click handler and
the GtkOverlay required by embedded playback. The handler downcast the
WebView's new grandparent to GtkWindow before checking that this app is
decorated, causing a non-unwinding panic on clicks. Embedded-surface setup now
removes that no-op handler before reparenting; native decorated-window resizing
and WebKit event handling remain in place. `cargo check --manifest-path
src-tauri/Cargo.toml`, strict Clippy, and Tauri tests passed (21, 2 ignored).
`npm run tauri -- build --no-bundle` passed and refreshed the release executable
used by the `locadora` alias. Tape inspection still needs the user's recheck.

2026-09-27 correction: user retesting showed the same callback still firing.
The first fix used bulk signal-ID disconnection, but that matching mode was
added only in GLib 2.78 while this machine has GLib 2.74. The replacement finds
the connected callback, disconnects its exact handler ID, verifies that it is
gone, and aborts setup safely instead of reparenting if either step fails. A
new `npm run tauri -- build --no-bundle` release build passed (1m50s) and
refreshed the executable used by the `locadora` alias. User retesting proved
this second approach was also incomplete: Wry owns an earlier callback for
synthetic back/forward mouse buttons, so the lookup removed Wry's callback and
left Tauri's crashing callback connected.

2026-09-27 verified GTK fix: callback removal has been discarded. The pinned
`tauri-runtime-wry` 2.11.4 source is patched locally at the two unsafe ancestry
downcasts in its mouse and touch resize handlers, matching the fallible behavior
in upstream development code. A source diff confirmed those are the only
changes to the vendored crate; Cargo tree confirmed the application resolves
that local path. A real X11 debug-window smoke test sent a left click into the
WebView and verified both process and window remained alive; the prior build
aborted on that event. The `appmenu-gtk-module` warning still appears but did
not affect the click test. `npm run typecheck` passed; `npm test` passed (25
files, 95 tests); strict Clippy and formatting passed for both Rust crates;
Tauri tests passed (22, 2 ignored), including a source guard for both fallible
handlers; native-core passed all 18 tests outside the socket-restricted
sandbox. `npm run tauri -- build --no-bundle` passed (2m00s). The rebuilt
release process and exact X11 window both remained alive after the same
synthetic left click. Opening an actual tape still needs the user's recheck.

2026-09-26 embedded-player checkpoint: the Linux shell now initializes libmpv
directly and renders its OpenGL output in a GTK GLArea inside Tauri's existing
main window. The React Watch flow reserves and continuously reports a 16:9
surface, keeps Locadora controls around it, and requests video-only fullscreen;
Escape is also handled natively so hidden controls cannot trap the user. The
renderer and libmpv lifecycle are ordered across GTK's main thread. Official
Stremio Video now receives `mpvSeparateWindow: false`; existing bounded IPC,
buffering and native subtitles remain in use. Frontend tests pass (25 files,
95 tests); Tauri tests pass (21, 2 ignored); native-core passes 18 tests outside
the socket-restricted sandbox, including proof that embedded mode creates no
child mpv window. Both Rust crates pass strict Clippy and formatting. `npm run
tauri -- build --no-bundle` passed (2m46s) and refreshed the executable used by
the `locadora` alias. `ldd` resolves system libmpv, GTK 3 and libepoxy with no
missing library. User visual/GPU/configured-source playback acceptance remains
pending.

Release handoff: `npm run tauri -- build --no-bundle` passed (frontend build and
optimized native build, 1m48s), refreshing
`src-tauri/target/release/wills-locadora-player`, the target of the user's
`locadora` alias. Restart any already-running instance to test this build.
Dependency notices now include the test-only fake-indexeddb package.

2026-09-26 playback checkpoint: external subtitle lookup no longer blocks
playback. Subtitles now download through the bounded native HTTPS boundary and
render in mpv's actual video window, with selection/off, explicit earlier/later
sync controls, loading/error feedback, and release/file-specific delay storage.
The transport preserves buffering across pause/seek events and avoids overlapping
event polls. mpv has bounded forward/back caches and a 60-second read-ahead
target; the UI now has localized playback phases, seeking and buffered seconds.
The player still uses a separate window. Auto-sync feasibility was researched
and documented, not implemented.
Checks: `npm run typecheck` passed; `npm test` passed (25 files, 94 tests);
`cargo test --manifest-path src-tauri/Cargo.toml` passed (20, 2 ignored);
`cargo test --manifest-path crates/native-core/Cargo.toml -- --test-threads=1`
passed outside the restricted socket sandbox (17 tests). Its synthetic null-
output mpv test verifies actual subtitle selection, -1.5-second delay and stale
selection rejection. The sandbox-only run could not open mpv sockets.
`git diff --check` passed. No manual visual or user-source streaming test ran.

2026-09-26 checkpoint: artwork now decodes native data without a CSP-blocked
fetch; production policy admits blob images. Shelf and inspection share native
downloads. Inspection textures update in place and mesh resources are disposed.
Catalogue persistence uses bounded IndexedDB records and locale-specific detail
keys, with safe legacy shelf migration and a bounded session fallback.
`npm run typecheck` passed; `npm test` passed (24 files, 89 tests), including
IndexedDB reopen and language isolation. Native rebuild is recorded above;
no visual acceptance claimed.

1. Done: the accessible 2D shelf is now the default surface and the immersive
   shelf is an explicit opt-in. Loading another stand appends a distinct
   physical rack below the prior rack instead of replacing it or merging both
   result pages into one giant shelf. The counter action is "Alugar" and rents
   only the tapes selected at checkout, and every stream candidate is listed
   while watching so sources can be switched without waiting for a failure.
2. In progress: the 3D tape inspection (port of the reference web inspector),
   which now fills the viewport, preserves both poster and backdrop after either
   image load order, fetches bounded public credits/rating/runtime/classification
   and Brazilian provider metadata, and closes when its surrounding stage is
   clicked. It still needs the user's visual acceptance.
3. Done: reviews no longer open from tape inspection. After the return desk
   successfully records an explicit watched outcome, that exact canonical tape's
   review form opens immediately below the return desk. Eligibility remains
   independently enforced by the existing watched-return Worker contract.
4. Implemented, awaiting user acceptance: external subtitles are downloaded
   natively and handed to mpv, so they render in the actual playback window.
   Synthetic mpv IPC verifies selection and delay; configured-source subtitle
   availability, appearance and perceived sync still need user acceptance.
5. Implemented, awaiting user acceptance: libmpv renders through a GTK GLArea
   in the existing Locadora window. Fullscreen is video-only and returns with
   Escape. Linux OpenGL behavior and configured-source playback need a user run.

Do not claim visual or playback acceptance until the user reports it.

## Phase board

- [ ] Phase 0 — evidence and licensing spike
  - [x] Initialize a separate repository with no production credentials.
  - [x] Add durable progress and decision tracking.
  - [x] Lock repository license and initial third-party notices.
  - [x] Integrate and pin official Stremio Core for the add-on protocol.
  - [x] Compile a deny-by-default Tauri shell and native HTTPS transport.
  - [x] Prove installed mpv capability without accepting a media argument.
  - [x] Prove the native mpv bridge on Debian without logging a playback URL.
  - [ ] Confirm real add-on response fields using user-supplied sanitized data.
  - [ ] Meet all Phase 0 exit criteria from the plan.
- [ ] Phase 1 — application shell and Locadora visual skeleton
  - [x] Scaffold React, TypeScript, Vite, and production license output.
  - [x] Implement responsive accessible 2D shelves and VHS inspection.
  - [x] Add genre, year, movie/series, locale, search, loading, and error states.
  - [x] Add visible Cesta/Balcão/account concepts with later-phase writes disabled.
  - [x] Remove provider-first and Stremio-catalogue controls.
  - [x] Route public discovery through the native-safe production transport.
  - [x] Implement the immersive enhancement and 2D failure fallback.
  - [ ] Meet all Phase 1 exit criteria and receive user visual approval.
- [ ] Phase 2 — Locadora member services
  - [x] Store the Locadora bearer session separately in the OS credential store.
  - [x] Restore, sign in, and sign out through the existing Better Auth contract.
  - [x] Load and normalize profile, active rental, collections, and initial history.
  - [x] Add account creation and profile onboarding.
  - [x] Add independent device-local and account collection actions.
  - [x] Add participation-time Balcão rental checkout.
  - [x] Add explicit return-desk outcomes independent from playback.
  - [x] Add bounded, deduplicated history pagination.
  - [x] Add public review reading and eligible member review writes.
  - [x] Integrate donations without coupling payment and rental state.
- [ ] Phase 3 — media engine and add-on configuration
  - [x] Store secret-bearing manifest configuration in the OS credential store.
  - [x] Validate manifests natively and return sanitized capabilities only.
  - [x] Add individual removal and full local disconnect actions.
  - [x] Fetch stored add-on resources by sanitized ID without returning URLs.
  - [x] Replace handwritten protocol parsing with official Stremio Core.
  - [x] Resolve one selected title across all compatible configured stream add-ons.
  - [x] Resolve movie subtitle add-ons for the active IMDb identity.
  - [x] Add bounded cancellation and sanitized diagnostic aggregation.
  - [x] Connect torrent descriptors to official Stremio Service conversion.
  - [x] Import the installed Stremio collection without copying account state.
  - [ ] Meet all Phase 3 exit criteria.
- [ ] Phase 4 — Quick Watch movies
  - [x] Implement and boundary-test the versioned deterministic movie evaluator.
  - [x] Connect a safe direct-URL winner and manual fallback picker to title inspection.
  - [x] Add a setting to disable Quick Watch without changing the default rules.
  - [ ] Meet all Phase 4 exit criteria with a real sanitized add-on fixture.
- [ ] Phase 5 — native playback, audio, and subtitles
  - [x] Connect native start/load/events/control/shutdown to the Watch flow.
  - [x] Replace custom frontend player state with official Stremio Video.
  - [x] Feed sanitized mpv buffering and embedded-track properties into Stremio Video.
  - [x] Allow source switching without crossing into Locadora member state.
  - [x] Add retry presentation and embedded audio selection.
  - [x] Add PT/EN-first subtitles, other-language reveal, immediate delay controls, and release-scoped delay memory.
  - [ ] Meet all Phase 5 exit criteria.
- [ ] Phase 6 — Linux packaging
- [ ] Phase 7 — Windows shell and installer
- [ ] Phase 8 — series Quick Watch (P1 rules and P2 integration complete; real playback acceptance pending)

## Working decisions

See `docs/DECISIONS.md`. Defaults chosen to unblock the build remain provisional
when they need user or real-environment confirmation.

## Verification log

- 2026-09-27 documentation handoff: `git diff --check` passed after removing
  trailing whitespace. A `node --input-type=module` filesystem/ledger check
  verified all 17 referenced handoff/code targets exist and exactly one
  `Next task:` remains. No runtime tests, GUI launch or build were needed for
  this documentation-only checkpoint.
- 2026-09-22: confirmed the destination initially contained only the plan and
  was not a Git repository.
- 2026-09-22: inspected the reference project's agent boundaries, package
  metadata, visible page structure, and public discovery call sites read-only.
- 2026-09-22: verified upstream Tauri (MIT/Apache-2.0), Stremio Core (MIT), and
  mpv licensing modes; recorded the initial distribution boundary in
  `THIRD_PARTY_NOTICES.md`.
- 2026-09-22: `npm run check` passed: TypeScript, 49 Vitest tests in 7 files,
  and the Vite production build. `git diff --check` also passed. No browser or
  manual visual/playback testing was performed.
- 2026-09-22: installed the user-local Rust 1.98.1 toolchain and the user
  installed Debian Tauri/mpv prerequisites. Verified mpv 0.35.1, libmpv 2.0.0,
  WebKitGTK 2.50.6, and GTK 3.24.38.
- 2026-09-22: `npm run check` passed with 51 tests in 8 files; native-core has
  6 passing Rust tests; the Tauri shell has 2 passing Rust tests. Both Rust
  crates passed `cargo fmt --check` and strict Clippy (`-D warnings`).
- 2026-09-22: `npm run tauri -- build --no-bundle` produced the optimized
  x86-64 Linux executable. `ldd` reported WebKitGTK/GTK/JavaScriptCore links and
  no missing libraries. The executable was not launched.
- 2026-09-22: `LOCADORA_REQUIRE_MPV_SMOKE=1 cargo test --manifest-path
  crates/native-core/Cargo.toml` passed all 10 native-core tests. The smoke test
  loaded an internal generated video source through a private mpv Unix socket,
  observed `file-loaded` and `end-file`, then cleaned up. No media descriptor
  appeared in process arguments or diagnostics.
- 2026-09-22: the Tauri shell tests passed, strict Clippy passed for both Rust
  crates, and `npm run check` passed with 54 tests in 9 files plus the production
  web build. No browser/manual visual or audible playback check was performed.
- 2026-09-22: the ignored live keyring integration test successfully wrote,
  read, deleted, and confirmed deletion of a synthetic credential through the
  Linux Secret Service. No user manifest or production credential was used.
- 2026-09-22: protected media configuration passed 55 shared tests, 4 regular
  Tauri tests, strict Clippy, and another optimized no-bundle Tauri build. The
  settings UI displays only sanitized add-on metadata and keeps manifest input
  desktop-only.
- 2026-09-22: configured stream resolution and the Watch flow passed
  `npm run check` with 61 tests in 10 files and a production build. Both Rust
  crates passed `cargo fmt --check`, strict Clippy, and their regular tests;
  native-core passed all 10 tests with `LOCADORA_REQUIRE_MPV_SMOKE=1`, including
  the private IPC smoke test. `npm run tauri -- build --no-bundle` also produced
  the optimized Linux executable. No browser/manual visual or real-media
  playback testing was performed.
- 2026-09-22: corrected the media architecture to link official MIT-licensed
  Stremio Core at pinned revision `b3062f7f`. Removed the duplicate TypeScript
  protocol client and native resource URL builder. `npm run check` passed with
  49 tests in 8 files; native-core passed 10 tests, the Tauri shell passed 6
  regular tests with 1 ignored credential-store integration test, and both
  crates passed strict Clippy. No manual testing was performed.
- 2026-09-22: integrated official `@stremio/stremio-video` 0.0.98 and removed
  the custom frontend player reducer. Its ShellVideo messages now pass through
  a tested, deny-by-default Tauri/mpv property adapter. `npm run check` passed
  with 47 tests in 8 files and a production build; native-core passed 11 tests,
  the Tauri shell passed 6 regular tests with 1 ignored credential-store test,
  both Rust crates passed strict Clippy, and `npm run tauri -- build
  --no-bundle` produced the optimized Linux executable. The larger production
  bundle includes the official libass/WASM subtitle runtime. No manual testing
  was performed.
- 2026-09-22: mapped torrent candidates into official Stremio Video's stream
  shape and enabled its official Stremio Service conversion path at the fixed
  `127.0.0.1:11470` endpoint. Arbitrary localhost playback remains denied;
  native-core accepts only a bounded hash/file service URL. Sanitized embedded
  track, buffering, volume, speed, and video-property events now reach
  ShellVideo. `npm run check` passed with 51 tests in 9 files and a production
  build; native-core passed 12 tests, the Tauri shell passed 6 regular tests
  with 1 ignored credential-store test, and both Rust crates passed strict
  Clippy. No real torrent or manual playback test was performed.
- 2026-09-22: resolved movie subtitle resources through official Stremio Core
  and fed bounded tracks into official Stremio Video. The Locadora Watch panel
  now exposes Stremio-owned embedded audio/subtitle selection, PT/EN-first
  filtering, deliberate other-language reveal, direct and keyboard delay
  adjustment, release-and-track-scoped delay persistence, and source retry.
  `npm run check` passed with 55 tests in 11 files and a production build. No
  browser/manual visual, audible, subtitle-rendering, or playback test was
  performed.
- 2026-09-22: audited the read-only Locadora web source and confirmed it is
  vanilla JavaScript/Three.js rather than React. Ported its MIT-licensed genre
  themes, camera/lighting values, 10x4 rack geometry, plaque treatment, and
  keyboard/pointer interactions into a lazy React/Three immersive enhancement.
  The 2D shelf remains the default and stays mounted until WebGL succeeds;
  startup failure restores it. `npm run check` passed with 59 tests in 13 files
  and a production build. No browser/manual visual or WebGL test was performed.
- 2026-09-22: added the secondary Automatic Quick Watch preference. It defaults
  on, persists locally, and when disabled retains the same versioned evaluation
  and manual candidates while suppressing autoplay only. `npm run check` passed
  with 57 tests in 12 files and a production build. No manual testing was
  performed.
- 2026-09-22: added the first Locadora member-service slice using the existing
  Better Auth/private Worker contracts through fixed native endpoints. Member
  bearer material uses a dedicated OS-keyring namespace, is not returned to
  React, and is unaffected by media disconnect. The account panel now restores
  sessions, signs in/out, and presents normalized profile, active-rental,
  collection, and initial-history state while browser builds remain anonymous.
  `npm run check` passed with 62 tests in 14 files and a production build; the
  Tauri shell passed 9 tests with 1 ignored credential-store integration test;
  both Rust crates passed strict Clippy and formatting checks. Native-core
  passed all 13 tests outside the filesystem sandbox, including its synthetic
  private-mpv IPC tests; those two mpv tests cannot open a Unix control socket
  inside the sandbox. No live member credentials, browser/manual testing, or
  production member mutation was used.
- 2026-09-22: added Better Auth desktop account creation with bounded
  email/username/password validation and a fixed trusted verification callback,
  plus private Worker profile onboarding. The account UI supports sign-in versus
  signup modes, password confirmation, public-name completion, and clears
  password fields after use. `npm run typecheck`, 63 Vitest tests in 15 files,
  and the production build passed; the Tauri shell passed 10 tests with 1
  ignored keyring integration test and strict Clippy. No live signup, email,
  browser/manual, or production member write was performed.
- 2026-09-22: connected tape inspection and the existing Salvos panel to
  independent `watch_later` and `favorite` collections. Anonymous saves persist
  as bounded normalized local metadata; signed-in changes mirror through fixed
  native private-Worker routes, and the panel combines both sources without
  coupling them to rentals or playback. `npm run check` passed with 66 tests in
  16 files and a production build; the Tauri shell passed 11 tests with 1
  ignored keyring integration test and strict Clippy. No browser/manual or live
  member-service write was performed.
- 2026-09-22: connected the existing Cesta/Balcão interaction to bounded native
  rental checkout. Anonymous users can stage up to three titles; checkout alone
  requires a restored member session and completed public profile, checks the
  active-rental limit, submits canonical snapshots to the fixed Worker route,
  refreshes member state, and clears the basket after success. `npm run
  typecheck`, 68 Vitest tests in 17 files, and the production build passed; the
  Tauri shell passed 12 tests with 1 ignored keyring integration test and strict
  Clippy. No browser/manual or live rental write was performed.
- 2026-09-22: added explicit account return actions for watched, not watched,
  and undisclosed outcomes. Native commands accept only validated UUID rental
  items and the three Worker-defined values; success reloads account state and
  history, while playback events remain incapable of returning or marking a
  title. `npm run typecheck`, 69 Vitest tests in 17 files, and the production
  build passed; the Tauri shell passed 13 tests with 1 ignored keyring
  integration test and strict Clippy. No browser/manual or live return write was
  performed.
- 2026-09-22: added bounded account-history pagination through the existing
  private Worker contract. Native offsets are limited to the server's 10,000
  maximum; response pages are normalized separately, deduplicated by rental-item
  ID, and halted by `hasMore`. `npm run typecheck`, 71 Vitest tests in 17 files,
  and the production build passed; the Tauri shell passed 14 tests with 1
  ignored keyring integration test and strict Clippy. No browser/manual or live
  history request was performed.
- 2026-09-22: added public title-review summaries/cards and authenticated review
  eligibility/publication through fixed native Worker routes. Titles are
  canonical movie/series TMDB identities; ratings are half-star steps from 0.5
  through 5, text is compacted and capped at 1,000 characters, and player/media
  state has no review mutation path. `npm run typecheck`, 74 Vitest tests in 19
  files, and the production build passed; the Tauri shell passed 15 tests with
  1 ignored keyring integration test and strict Clippy. No browser/manual or
  live review write was performed.
- 2026-09-22: added a standalone voluntary-support modal using the same
  intentionally public Pix copy-and-paste payload as the Locadora website. It
  stores no payment or confirmation state and has no path into rentals, member
  state, media configuration, or playback. `npm run check` passed with 76 tests
  in 20 files and a production build. No browser/manual or payment test was
  performed.
- 2026-09-22: found the user's official Stremio 4.4.168 Flatpak collection and
  inspected only its add-on record through a temporary read-only decoder: 33
  descriptors, including Cinemeta, Torrentio, IMDb Catalogs, TMDB, and three
  subtitle sources. Added a fixed-path, exact-key native importer using
  `leveldb-core`; 32 HTTPS entries validate for protected import and only the
  private-HTTP Local Files source is rejected. `npm run check` passed with 76
  tests in 20 files and a production build. The Tauri shell passed 18 regular
  tests with 2 ignored integrations; its opt-in installed-collection test also
  passed against the real local LevelDB without printing URLs or account data.
  Strict Clippy passed, and `npm run tauri -- build --no-bundle` produced the
  optimized Linux MVP executable. No browser/manual or playback verification
  was performed.
- 2026-09-22: diagnosed the optimized binary's blank window. The production
  bundle threw `Cannot set properties of undefined (setting 'WebVTT')` while
  evaluating `vtt.js`, which Stremio Video requires for HTML subtitles: the
  dependency publishes its API through a top-level `this` that the bundler
  substitutes as `undefined` in ES module output. Added `tools/vttGlobalShim.ts`
  (a build-time transform handing those five UMD footers the real global) and
  `test/vttGlobalShim.test.ts`, which asserts the shipped files still use that
  footer. `npm run check` passed with 79 tests in 21 files and a production
  build. The optimized no-bundle binary was rebuilt and launched: its 1280x800
  window was captured and inspected programmatically, reporting 136,703 distinct
  colors and the Locadora palette where the pre-fix window was a single uniform
  color. This is not a human visual check, and no playback, subtitle, member
  service, or add-on import path was exercised.
- 2026-09-22: fixed desktop playback failing with "mpv did not open its private
  control channel" (mpv's window opened, then closed, and nothing played). The
  private control socket was built under the long app cache directory, giving a
  107-byte path; mpv cannot bind a Unix socket that long and fails silently, so
  the 3-second connect deadline expired and the session was torn down. The
  boundary was measured directly: 106 bytes binds, 107 bytes and longer do not.
  The runtime root is now the short `$XDG_RUNTIME_DIR` (falling back to the
  process temp directory) with a shorter session name, an over-long socket path
  is rejected with its own error instead of a timeout, and the Rust player tests
  now start mpv through the production root instead of `/tmp` only. native-core
  passed 15 tests including the opt-in private-IPC smoke test; the Tauri shell
  passed 18 tests with 2 ignored; both crates passed strict Clippy and
  `cargo fmt --check`. Playback inside the app is still unconfirmed: it needs a
  user play attempt.
- 2026-09-22: with the socket fixed, mpv stayed open but the Watch panel
  reported a generic "The native player command failed". Two defects: the shell
  transport collapsed every rejected native command into that one string, and
  the native descriptor allowlist rejected the official service's `/proxy/`
  stream form, which Stremio Video generates for any direct stream that needs
  request headers. The allowlist now accepts `/proxy/` (still only the official
  `127.0.0.1:11470` origin, no credentials, fragment, or path traversal), and
  the transport reports the native reason for a rejected load while ignoring
  rejected cosmetic properties, which no longer end playback. `npm run check`
  passed 80 tests in 21 files; native-core passed 16 tests. Playback inside
  the app is still unconfirmed.
- 2026-09-22: desktop playback worked but stuttered badly. Measured the live
  session through mpv's own IPC socket (the app's socket accepts a second,
  read-only client): the stream was 1920x800 23.976 yuv420p with a six-minute
  demuxer cache, no underruns, and zero decoder drops, while the video output
  discarded about 13 frames per second. Decoding was running in software,
  because Stremio Video asks for `hwdec=auto-copy` and every copy-back driver is
  refused on this machine ("Not using this for auto-copy"). Zero-copy VAAPI does
  work here: measured on film-like 1080p content it costs 9% of a core against
  48% for software. The shell now translates that request to `hwdec=auto`
  (zero-copy first, copy-back as fallback), which is correct for a shell that
  renders through a real `vo=gpu` window rather than the libmpv render API.
  `npm run check` passed with 81 tests in 21 files. Smooth playback is not yet
  confirmed by the user.
- 2026-09-22: the stutter was traced to the chosen stream itself, not the player
  configuration. Started the player UX parity work: 3D shelf by default with the
  toggle in the header, the counter action renamed to "Alugar" with per-tape
  selection at checkout, every stream candidate listed while watching with the
  current one marked, and real inspection data (poster art, type, year, genres,
  synopsis, identifiers). `npm run check` passed with 82 tests in 21 files. The
  3D tape inspection, subtitles, and player embedding remain open; no visual
  acceptance was claimed.
- 2026-09-23: matched the tape inspection presentation to the reference web
  viewport. The Three.js host now uses the full dialog height, whole-case
  focus starts at a full-case-safe scale, and desktop action controls float
  beside the case with a responsive bottom dock below 900px. `npm test` passed
  with 82 tests in 21 files; `npm run build` and `git diff --check` also
  passed. No browser or manual visual/playback acceptance was performed.
- 2026-09-23: corrected the first viewport parity pass after user feedback.
  Front/back focus no longer forces a 1.35× crop; camera distance is now
  calculated from the case dimensions and live viewport aspect ratio, with a
  4% framing margin and no zoom level above the complete-case view. The dialog
  explicitly occupies the viewport, and the focus controls overlay the canvas.
  `npm run check` passed with 82 tests in 21 files. No manual visual/playback
  acceptance was performed.
- 2026-09-23: made the 2D shelf the default while immersive remains an explicit
  opt-in, and changed "Carregar outra estante" to replace its physical shelf
  instead of merging its titles. Replaced the numeric year field with a native
  dropdown while retaining the side minus/plus controls, made the genre chooser
  dark Locadora blue on paper for contrast, and split the Cesta action from the
  utility dock so it cannot overlap saved/favorite controls. Inspection now
  closes when a short click lands outside the rendered case, retains poster and
  backdrop independently regardless of their image-load order, and requests
  bounded public title metadata for rating, runtime, BR classification, main
  credits, and BR providers through a new fixed native title route. `npm run
  typecheck`, `npm test` (83 tests in 21 files), `npm run build`,
  `npm run check:native` (19 passed, 2 ignored), and `git diff --check` passed.
  `npm run tauri -- build --no-bundle` then refreshed
  `src-tauri/target/release/wills-locadora-player`. No browser/manual visual or
  playback acceptance was performed.
- 2026-09-23: moved review entry to the natural watched-return flow. Tape
  inspection no longer exposes the review control; after a successful explicit
  `watched` return, its matching canonical title renders the review form beneath
  the return desk. The Worker eligibility check and review-write route remain
  unchanged, so an unwatched tape cannot become reviewable through the UI or the
  service. The native year selector explicitly uses the prior dark field and
  option background. `npm run typecheck`, `npm test` (83 tests in 21 files),
  `npm run build`, and `git diff --check` passed. `npm run tauri -- build
  --no-bundle` refreshed `src-tauri/target/release/wills-locadora-player`. No
  browser/manual visual or playback acceptance was performed.
- 2026-09-23: corrected stand pagination after clarifying the physical-store
  model. Each catalogue page now remains its own bordered rack and subsequent
  stands append vertically; titles are filtered per stand rather than flattened
  into one rack. Appended cover images request eagerly to avoid WebKit failing
  to activate newly inserted lazy images. Tape-back text now honors its exact
  line limit, single-line metadata is width-bounded, the printable area is
  clipped, and the random barcode was replaced with a deterministic EAN-13-like
  rendering. `npm run typecheck`, `npm test` (84 tests in 22 files), `npm run
  build`, and `git diff --check` passed. `npm run tauri -- build --no-bundle`
  refreshed `src-tauri/target/release/wills-locadora-player`. No manual visual
  acceptance was performed.
- 2026-09-23: replaced the year field's system-native select with an accessible
  app-rendered dropdown after WebKitGTK kept painting the native option popup
  white despite explicit option styles. The closed field, scrollable year list,
  and selected state now use controlled dark Locadora colors while retaining
  the side minus/plus buttons. `npm run typecheck`, `npm test` (85 tests in 22
  files), `npm run build`, and `git diff --check` passed. `npm run tauri -- build
  --no-bundle` refreshed `src-tauri/target/release/wills-locadora-player`. No
  manual visual acceptance was performed.
- 2026-09-23: added the first local-first catalogue layer. Shelf pages and
  complete inspection records now persist locally and are reused before any
  network request; newly fetched records retain their artwork URLs. Poster
  artwork uses a bounded persistent Cache Storage cache, while backdrops use a
  smaller inspection-only cache. Removed streaming-provider presentation from
  the tape back. `npm run typecheck`, `npm test` (87 tests in 23 files),
  `npm run build`, and `git diff --check` passed. `npm run tauri -- build
  --no-bundle` refreshed `src-tauri/target/release/wills-locadora-player`. No
  manual visual or network-cache acceptance was performed.
- 2026-09-23: fixed poster priority in the local artwork layer. Posters now
  receive their known URL immediately while Cache Storage warms in parallel;
  cached blobs are used on later opens instead of blocking first render. This
  prevents a shelf poster or inspection cover from waiting behind cache I/O
  while a backdrop loads. `npm run typecheck`, `npm test` (88 tests in 24
  files), and `git diff --check` passed. `npm run tauri -- build --no-bundle`
  refreshed `src-tauri/target/release/wills-locadora-player`. No manual visual
  or network-cache acceptance was performed.
- 2026-09-23: fixed the separate 3D artwork path. The shelf may use direct
  TMDB URLs in normal `<img>` elements, but the canvas/WebGL inspector now
  routes TMDB artwork through the existing CORS-safe Locadora image proxy before
  texture upload; cached blobs remain local and bypass the proxy on later
  opens. `npm run typecheck`, `npm test` (89 tests in 24 files), and
  `git diff --check` passed. `npm run tauri -- build --no-bundle` refreshed
  `src-tauri/target/release/wills-locadora-player`. No manual visual or
  network-cache acceptance was performed.
- 2026-09-23: corrected the preceding 3D-artwork fix after the Worker proxy
  blocked the desktop WebView origin and caused both poster and backdrop to
  disappear. Inspection no longer uses that proxy. A new native command accepts
  only HTTPS `image.tmdb.org/t/p/` paths, downloads at most 8 MB with image
  content-type validation, and returns canvas-safe local data; poster and
  backdrop are then persisted in their existing bounded caches. `npm run
  typecheck`, `npm test` (89 tests in 24 files), `cargo test --manifest-path
  src-tauri/Cargo.toml` (20 passed, 2 ignored), `cargo test --manifest-path
  crates/native-core/Cargo.toml -- --test-threads=1` outside the restricted
  sandbox (16 passed), `npm run build`, and `git diff --check` passed. `npm run
  tauri -- build --no-bundle` refreshed
  `src-tauri/target/release/wills-locadora-player`. No manual visual or live
  artwork acceptance was performed.

## Known blockers and risks

- Linux playback is embedded through libmpv/GTK GLArea. User visual/GPU/playback
  acceptance is pending. Preserve the patched Tauri GTK resize handlers and
  respect native/WebView stacking during the player redesign.
- The sanitized fixture from the user's configured stream add-on is still needed
  to confirm Torrentio-style field reliability. Synthetic fixtures may be used
  for implementation but cannot close that Phase 0 criterion.
- Torrent playback uses the bundled compatible engine on port 11471 (D-018).
  Real peer transfer, clean installation and final distribution-license/source
  acceptance remain open; a running external Stremio is not required.
- Series Quick Watch rules and P2 playback wiring are complete under D-032.
  Automated coverage is green; real configured-source and playback acceptance
  remains pending with the owner.
- Public release licensing must be re-reviewed after the final native/player
  dependency graph is locked.
- Phase 2 contract/UI tests use synthetic data; a real member login, account
  state comparison, collection/rental/return/review round trip, and email signup
  remain required before the phase exit criteria can be closed.
