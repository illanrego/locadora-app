# Implementation progress

Last updated: 2026-09-22
Current milestone: official Stremio application integration
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

Next task: expose sanitized mpv track/buffering properties to the official
ShellVideo model, then connect official Stremio local streaming-service
discovery so torrent descriptors can use Stremio Video's own conversion path.
Preserve the Locadora React presentation and Quick Watch policy.

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
  - [ ] Implement the immersive enhancement and 2D failure fallback.
  - [ ] Meet all Phase 1 exit criteria and receive user visual approval.
- [ ] Phase 2 — Locadora member services
- [ ] Phase 3 — media engine and add-on configuration
  - [x] Store secret-bearing manifest configuration in the OS credential store.
  - [x] Validate manifests natively and return sanitized capabilities only.
  - [x] Add individual removal and full local disconnect actions.
  - [x] Fetch stored add-on resources by sanitized ID without returning URLs.
  - [x] Replace handwritten protocol parsing with official Stremio Core.
  - [x] Resolve one selected title across all compatible configured stream add-ons.
  - [ ] Resolve subtitle add-ons for the active video/release identity.
  - [x] Add bounded cancellation and sanitized diagnostic aggregation.
  - [ ] Meet all Phase 3 exit criteria.
- [ ] Phase 4 — Quick Watch movies
  - [x] Implement and boundary-test the versioned deterministic movie evaluator.
  - [x] Connect a safe direct-URL winner and manual fallback picker to title inspection.
  - [ ] Add a setting to disable Quick Watch without changing the default rules.
  - [ ] Meet all Phase 4 exit criteria with a real sanitized add-on fixture.
- [ ] Phase 5 — native playback, audio, and subtitles
  - [x] Connect native start/load/events/control/shutdown to the Watch flow.
  - [x] Replace custom frontend player state with official Stremio Video.
  - [x] Allow source switching without crossing into Locadora member state.
  - [ ] Add retry presentation, audio selection, and the complete subtitle flow.
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

## Known blockers and risks

- A sanitized fixture from the user's configured stream add-on is still needed
  to confirm Torrentio-style field reliability. Synthetic fixtures may be used
  for implementation but cannot close that Phase 0 criterion.
- The synthetic add-on fixture proves deterministic code behavior but does not
  count as the user-configured sanitized response required by Phase 0.
- A real user-configured sanitized response is still required before parser
  field reliability and Phase 0 can be closed.
- The current player can load direct HTTPS stream URLs. Torrent descriptors are
  intentionally non-playable until a bounded, license-reviewed resolver is
  selected and implemented.
- Series Quick Watch rules are deliberately undefined.
- Public release licensing must be re-reviewed after the final native/player
  dependency graph is locked.
