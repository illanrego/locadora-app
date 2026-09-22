# Implementation progress

Last updated: 2026-09-22
Current milestone: Phase 0 native proof + Phase 1 visual skeleton
Status: in progress

## Resume checkpoint

The first executable React/TypeScript slice is implemented and tested. It
renders an accessible responsive Locadora shelf from explicitly synthetic
fixtures, with a separately configurable public discovery adapter. The pure
media layer includes add-on protocol validation, stream normalization, movie
Quick Watch v1, subtitle prioritization/fingerprints, and log redaction.

Next task: scaffold the Tauri 2 boundary and implement the first deny-by-default
native media commands: capability reporting, safe add-on fetch transport, and a
system-mpv availability probe that never accepts or logs a playback URL. Install
or document missing Debian/Rust prerequisites, then keep UI code behind a
platform-neutral adapter.

## Phase board

- [ ] Phase 0 — evidence and licensing spike
  - [x] Initialize a separate repository with no production credentials.
  - [x] Add durable progress and decision tracking.
  - [x] Lock repository license and initial third-party notices.
  - [x] Scaffold and prove the add-on protocol client with synthetic sanitized fixtures.
  - [ ] Prove the native mpv bridge on Debian without logging a playback URL.
  - [ ] Confirm real add-on response fields using user-supplied sanitized data.
  - [ ] Meet all Phase 0 exit criteria from the plan.
- [ ] Phase 1 — application shell and Locadora visual skeleton
  - [x] Scaffold React, TypeScript, Vite, and production license output.
  - [x] Implement responsive accessible 2D shelves and VHS inspection.
  - [x] Add genre, year, movie/series, locale, search, loading, and error states.
  - [x] Add visible Cesta/Balcão/account concepts with later-phase writes disabled.
  - [x] Remove provider-first and Stremio-catalogue controls.
  - [ ] Route public discovery through the native-safe production transport.
  - [ ] Implement the immersive enhancement and 2D failure fallback.
  - [ ] Meet all Phase 1 exit criteria and receive user visual approval.
- [ ] Phase 2 — Locadora member services
- [ ] Phase 3 — media engine and add-on configuration
- [ ] Phase 4 — Quick Watch movies
- [ ] Phase 5 — native playback, audio, and subtitles
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

## Known blockers and risks

- A sanitized fixture from the user's configured stream add-on is still needed
  to confirm Torrentio-style field reliability. Synthetic fixtures may be used
  for implementation but cannot close that Phase 0 criterion.
- Rust, cargo, mpv, and libmpv were not available when first probed on this
  Debian environment. Tauri/WebKitGTK prerequisites still require verification.
- The synthetic add-on fixture proves deterministic code behavior but does not
  count as the user-configured sanitized response required by Phase 0.
- Series Quick Watch rules are deliberately undefined.
- Public release licensing must be re-reviewed after the final native/player
  dependency graph is locked.
