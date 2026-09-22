# Implementation progress

Last updated: 2026-09-22
Current milestone: MVP user acceptance
Status: in progress

## Resume checkpoint

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

Next task: player UX parity with the web version, in this order.

1. Done: the 3D shelf is the default surface (2D stays as the WebGL fallback),
   the counter action is "Alugar" and rents only the tapes selected at checkout,
   and every stream candidate is listed while watching so sources can be
   switched without waiting for a failure. The inspection shows poster art,
   type, year, genres, synopsis, and identifiers.
2. In progress: the 3D tape inspection (port of the reference web inspector),
   which also needs the remaining reference details for the counter flow.
3. Pending: subtitles. Add-on subtitle tracks are fetched and handed to Stremio
   Video, but with the player in its own window its HTML subtitle renderer draws
   into a hidden container, so those tracks never appear. Fix by handing the
   track to mpv, or by embedding the player (next item).
4. Pending: embed the player. Stremio Video asks the shell for `vo=libmpv` and
   the shell currently ignores it and runs a separate mpv window. Implementing
   the render API into a GL widget inside the Tauri window removes the extra
   window and makes HTML subtitle rendering work.

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

## Known blockers and risks

- The Linux shell still plays through a separate mpv window. Stremio's own
  ShellVideo asks the shell for embedded `vo=libmpv`, and the current transport
  discards that command, so in-window playback still needs a native shell that
  renders mpv inside the app window.
- The sanitized fixture from the user's configured stream add-on is still needed
  to confirm Torrentio-style field reliability. Synthetic fixtures may be used
  for implementation but cannot close that Phase 0 criterion.
- The synthetic add-on fixture proves deterministic code behavior but does not
  count as the user-configured sanitized response required by Phase 0.
- A real user-configured sanitized response is still required before parser
  field reliability and Phase 0 can be closed.
- Torrent playback requires a separately installed/running official Stremio
  Service. Its eventual installer/bundling model and GPL-2.0 obligations remain
  part of the public distribution review.
- Series Quick Watch rules are deliberately undefined.
- Public release licensing must be re-reviewed after the final native/player
  dependency graph is locked.
- Phase 2 contract/UI tests use synthetic data; a real member login, account
  state comparison, collection/rental/return/review round trip, and email signup
  remain required before the phase exit criteria can be closed.
