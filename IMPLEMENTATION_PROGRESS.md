# Implementation progress

Last updated: 2026-09-22
Current milestone: Phase 2 Locadora member services
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

Next task: connect the existing Cesta/Balcão flow to the fixed private
`POST /v1/rentals` contract, requiring a signed-in member with a completed
profile only at checkout. Refresh member state after success and keep playback
events entirely outside the rental transition.

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
  - [ ] Add history pagination, rental, return, and review actions.
  - [ ] Integrate donations without coupling payment and rental state.
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

## Known blockers and risks

- A sanitized fixture from the user's configured stream add-on is still needed
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
