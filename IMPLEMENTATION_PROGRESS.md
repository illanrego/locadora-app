# Implementation progress

Last updated: 2026-09-22
Current milestone: Phase 0 — repository foundation, evidence, and licensing
Status: in progress

## Resume checkpoint

The repository has just been initialized from the implementation plan. The
existing `/home/illan/Documents/coding/locadora` project is reference-only and
has not been modified.

Next task: complete the dependency/license evidence check, then scaffold the
React/TypeScript UI, pure domain/media packages, and the Tauri native boundary.
The first executable slice should render the accessible Locadora shelf from a
sanitized discovery fixture while the live API adapter remains separately
configurable.

## Phase board

- [ ] Phase 0 — evidence and licensing spike
  - [x] Initialize a separate repository with no production credentials.
  - [x] Add durable progress and decision tracking.
  - [ ] Lock repository license and third-party notices.
  - [ ] Scaffold and prove the add-on protocol client with sanitized fixtures.
  - [ ] Prove the native mpv bridge on Debian without logging a playback URL.
  - [ ] Confirm real add-on response fields using user-supplied sanitized data.
  - [ ] Meet all Phase 0 exit criteria from the plan.
- [ ] Phase 1 — application shell and Locadora visual skeleton
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

## Known blockers and risks

- A sanitized fixture from the user's configured stream add-on is still needed
  to confirm Torrentio-style field reliability. Synthetic fixtures may be used
  for implementation but cannot close that Phase 0 criterion.
- Native mpv availability and the safest Tauri integration path must be probed
  on this Debian environment.
- Series Quick Watch rules are deliberately undefined.
- Public release licensing must be re-reviewed after the final native/player
  dependency graph is locked.

