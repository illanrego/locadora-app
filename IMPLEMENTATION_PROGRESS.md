# Implementation progress

Last updated: 2026-10-06
Current milestone: investigate source-dependent playback hiccups (separate from completed 2D UI work)
Status: UI published; timing correction checked and rebuilt; source-specific diagnosis unconfirmed

## Resume checkpoint

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

Next task: user retest the previously hiccuping source in the rebuilt desktop;
if interruptions remain, collect only allowlisted numeric cache/frame-drop/A-V
sync properties from a live player session to distinguish network starvation
from decode/render scheduling. Do not log descriptors or launch GUI tests without
request. Obtain 2D styling and fullscreen visual acceptance as part of this retest.
Signed-in rental-preference acceptance, clean-machine installation, Flatpak and
distribution audit remain outstanding.

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
- [ ] Phase 8 — series Quick Watch (blocked on product rules)

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
- Series Quick Watch rules are deliberately undefined.
- Public release licensing must be re-reviewed after the final native/player
  dependency graph is locked.
- Phase 2 contract/UI tests use synthetic data; a real member login, account
  state comparison, collection/rental/return/review round trip, and email signup
  remain required before the phase exit criteria can be closed.
