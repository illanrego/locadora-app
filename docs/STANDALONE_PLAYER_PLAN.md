# Standalone Locadora and player redesign

Updated: 2026-09-27. Status: engine artifact investigation blocked; player UI
implemented, automated checks and native build passed, user acceptance pending.

## Start here

The user has authorized planning and implementation of a self-contained desktop
Locadora with a modern player. The initial documentation handoff is complete;
implementation is underway. Engine packaging is blocked on the contract recorded
in `STREAMING_ENGINE_FINDINGS.md`. Player implementation/check/build results are
recorded in the root progress ledger; do not infer standalone delivery from them.

Read the repository's `AGENTS.md` and its four required documents first.
`WILLS_LOCADORA_PLAYER_PLAN.md` remains the product authority;
`docs/DECISIONS.md` records accepted refinements. This document is the execution
plan for the current priority. `IMPLEMENTATION_PROGRESS.md` owns the single next
task and verification record. Earlier playback plans are historical milestones.

Current continuation: resolve the engine direction after milestone 1's finding.
See `STREAMING_ENGINE_FINDINGS.md` for primary-source evidence and a compatible
candidate, and `../IMPLEMENTATION_PROGRESS.md` for the precise build checkpoint.
Milestone 3 implementation is ready for user acceptance. Routine implementation
does not need renewed product approval; adopting an unofficial replacement engine
is the outstanding architecture choice.

## What the user wants

- Users install only Will's Locadora. They must not install or run Stremio Desktop,
  Stremio Service, Node, mpv, or other media runtimes separately. Package dependencies
  may be installed automatically by the chosen installer/package manager.
- Reuse official Stremio components wherever they supply the required behavior.
  Locadora supplies its shelves, VHS inspection, member features and playback UI.
- The native app owns the lifecycle of its streaming engine. A separate Stremio
  installation, running desktop window, or imported installation is optional.
- Player UI should feel modern and sophisticated, like a streaming service, with
  Locadora's dark blue palette and subtle physical border details.
- Video stays inside the existing app window. Fullscreen is video-only, with a
  reliable Escape path back to the controls.
- Preserve source switching, buffering feedback, PT/EN-first subtitles, audio
  selection and immediate manual subtitle sync. AI/automatic sync remains an
  assessment, not an approved production feature.

## Current implementation and its gaps

| Area | Current evidence | Required change |
| --- | --- | --- |
| Add-on protocol | `crates/native-core/src/stremio.rs` uses pinned official Core transport/types | Keep reuse; assess Core models for additional orchestration where appropriate |
| Source selection | `src/media/resolutionService.ts`, `quickWatch.ts` normalize and rank configured add-on results | Preserve approved deterministic movie rules and manual series behavior |
| Player coordination | `src/media/useStremioVideo.ts` uses official Stremio Video and ShellVideo | Preserve ownership; supply the managed service endpoint |
| Streaming service | `src/platform/stremioService.ts` probes fixed `127.0.0.1:11470/network-info` for one second | Replace external-service dependence with a packaged, managed runtime |
| Native playback | `src-tauri/src/embedded_surface.rs` renders libmpv in a GTK GLArea | Preserve embedding, cleanup and fullscreen; package its dependencies |
| Player UI | `src/components/WatchFlow.tsx`, player rules in `src/styles.css` | Replace the tall utility-panel presentation with a coherent cinema layout |
| Packaging | Development/no-bundle build uses installed native libraries; no managed engine is shipped | Produce a reproducible single-install Linux package |

The earlier investigation found no listener at port 11470. That was a machine
snapshot, not a permanent diagnosis; recheck only if useful. The code independently
confirms that Locadora probes the service but does not start it. Core parses and
coordinates media data; it does not itself supply the torrent byte-serving engine.
Stremio Video's conversion path also needs that engine.

The GTK crash fix must be preserved: the locally patched Tauri runtime makes two
resize-handler window downcasts fallible after WebView reparenting. Do not restore
signal-handler removal. Automated/build and synthetic-click evidence is recorded
in the progress ledger; actual tape/playback acceptance remains open.

## Milestone 1 — Pin the engine and its distribution contract

1. Inspect official Stremio Service/server artifacts, build instructions and
   licenses. Determine exactly which artifact supplies the streaming API and what
   Node/runtime, FFmpeg or other companion files it requires. A service wrapper's
   license does not establish redistribution rights for every bundled asset.
2. Select and pin a reproducible Linux artifact/build with version, provenance,
   checksum, notices and required source availability. Avoid relying on files
   inside an existing Stremio Flatpak or a developer's machine.
3. Verify its supported startup arguments/environment, loopback binding, port
   selection, configuration/cache paths, readiness API and termination behavior.
   Choose a private app-owned endpoint if supported; document the actual supported
   contract before changing CSP or the native playback allowlist.
4. Record the packaging decision and exact acquisition/build steps in this repo.
   If redistribution of an essential artifact cannot be established, record the
   specific blocker and viable official build alternative; do not call an
   external-Stremio fallback completion of the standalone requirement.

Exit: a pinned, reproducible engine specification with verified startup and
redistribution requirements. No real manifests or playback URLs in artifacts/logs.

## Milestone 2 — Own the streaming-service lifecycle

1. Add a native supervisor for the packaged executable/resource. Use Tauri
   sidecar packaging where the artifact fits; include companion resources as
   needed. Do not implement a replacement torrent engine.
2. Start on media demand, coalesce concurrent starts, and wait for bounded
   readiness with response validation. Expose sanitized starting/ready/failed
   state and retry through allowlisted IPC.
3. Isolate Locadora's engine configuration/cache. Handle occupied ports without
   killing or silently adopting another application's process. Endpoint ownership
   and validation must remain native-controlled.
4. Pass the verified endpoint to official Stremio Video. Keep native URL checks,
   frontend CSP and service-origin permissions in agreement; never broadly allow
   arbitrary localhost playback/proxy requests to accommodate a new port.
5. Handle cancellation, startup failure and bounded crash recovery. On shutdown,
   terminate and reap only the process/process tree owned by this app. Preserve
   direct HTTP playback when it does not require service conversion.
6. Evaluate official Core `StreamingServer` model reuse against the pinned Core
   version. Keep process spawning and platform lifecycle in the shell adapter;
   avoid creating a duplicate stream-conversion or media-state engine.

Exit: automated lifecycle/IPC tests cover startup, readiness timeout, concurrent
requests, port conflict, crash/retry and shutdown ownership. A packaged engine
starts without Stremio Desktop or a separately installed service.

## Milestone 3 — Modern embedded player UI

Design direction:

- Make video the primary surface, framed by restrained dark blue/near-black
  chrome with thin borders, comfortable spacing and clear typography.
- Use a compact title/back header and one consistent transport dock: play/pause,
  skip, scrubber with played/buffered progress, time, volume/mute and fullscreen.
  Verify each control against the current Stremio/native contract before exposing it.
- Put audio/subtitles and manual sources in deliberate secondary panels. Keep
  source ranking/version details and technical diagnostics out of normal playback.
- Show loading, rebuffering, failure/retry and ended states without permanently
  crowding the picture. Keep cancellation and source switching reachable.
- Opening/selecting subtitles must expose compact earlier/later and numeric
  delay controls, with current loading/error feedback and release-scoped storage.
- Support keyboard navigation, visible focus, accessible names, PT/EN copy,
  reduced motion and smaller windows. Do not intercept text-entry keys.

Native constraint: the GTK video widget is layered above the WebView. Ordinary
CSS overlays cannot be assumed to draw over live video. Keep controls outside the
native rectangle unless a deliberate compositing change has been proven. The
current geometry reporter hides video when its frame extends outside the viewport;
size the layout to fit the window instead of pushing the video offscreen when
secondary panels open. Revisit geometry tests if changing this behavior.

Exit: frontend checks pass; meaningful interaction coverage verifies playback,
seeking, panels, subtitle sync and keyboard behavior. Rebuild the native executable
for user testing. User visual/GPU/playback acceptance remains separate from tests.

## Milestone 4 — Single-install Linux delivery

1. Package the engine plus required runtime/media libraries, codecs and notices.
   Follow the product's Flatpak-first, Debian-second order. Developer prerequisites
   in the README are not acceptable end-user installation steps.
2. Verify paths and subprocess execution within the actual package sandbox,
   clean installation with no Stremio, startup, playback, shutdown and relaunch.
   Use licensed/synthetic media for automated checks; real add-on testing remains
   user-configured and must not expose descriptors or credentials.
3. Verify X11/Wayland rendering and fullscreen, cache limits, uninstall behavior,
   and absence of orphaned engine processes. Record precisely what was exercised.
4. Document installation and build reproduction. Preserve Linux/Windows adapter
   separation; do not claim a Windows installer from the Linux work.

Exit: one Locadora installation supplies everything required to run its supported
playback flow. A no-bundle build alone cannot close this milestone.

## Verification and handoff discipline

- Work only in `locadora-app`; keep the web checkout read-only. Check dirty state
  before edits and preserve unrelated work.
- Keep Locadora member/rental/review state independent of player/service events.
  Never include private add-ons, tokens or media URLs in fixtures, logs or commits.
- Run `npm run check` for frontend changes. For affected Rust crates, run
  `cargo fmt --manifest-path <crate>/Cargo.toml --check`,
  `cargo clippy --manifest-path <crate>/Cargo.toml --all-targets -- -D warnings`
  and `cargo test --manifest-path <crate>/Cargo.toml`.
- Rebuild with `npm run tauri -- build --no-bundle` when handing executable
  changes to the user. Report the exact output path/build result, distinguishing
  it from an installed bundle and any already-running older instance.
- Do not launch a GUI or run manual/browser validation unless explicitly requested.
  Static tests and successful compilation do not establish visible playback.
- Commit verified milestones, update the progress ledger, and leave one next task.
  Do not repeat resolved product questions or mark incomplete phases complete.
