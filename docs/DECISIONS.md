# Product and architecture decisions

This log records decisions that refine
`WILLS_LOCADORA_PLAYER_PLAN.md`. A provisional decision unblocks implementation
but can be replaced without changing the product's core boundaries.

## Accepted for v1 implementation

### D-001 — Source alias typo

`ytfs` is treated as YTS/YIFY for candidate normalization.

### D-002 — Weak 720p results

When no 1080p candidate qualifies and no 720p candidate has at least 10
seeders, Quick Watch produces no automatic winner. The manual source picker
shows valid candidates and the explanation states why autoplay was withheld.

### D-003 — Initial media configuration

Local compatible add-on manifest URLs are the first implementation path.
Stremio account synchronization is deferred. Browsing never requires either
Locadora or media login.

### D-004 — Subtitle languages

Portuguese and English appear first. A deliberate “Other languages” action
reveals remaining tracks when present; they are not discarded.

### D-005 — Resume history

Local resume history is disabled initially. The player-state interface reserves
the capability, but nothing is persisted until retention and privacy behavior
are approved.

### D-006 — Series behavior

Series and episodes use the manual source picker. There is no episode autoplay,
season-pack selection, or reuse of movie size rules before Phase 8 approval.

### D-007 — Initial application stack

Use the existing Locadora React presentation for the visible product. Reuse the
official Stremio application modules for media behavior: pinned `stremio-core`
for add-on protocol/types/models and `stremio-video` for frontend player
coordination. Tauri remains the current narrowly allowlisted platform adapter,
not a replacement media engine. Locadora domain code must not depend directly
on either Tauri or Stremio state.

### D-008 — Stremio reuse boundary

The absence of Stremio catalogue UI does not mean reimplementing Stremio.
Stremio's visual routes are not exposed, while its official modular engine and
frontend media behavior are reused beneath the Locadora interface. Handwritten
protocol, media-state, or playback coordination code must be removed when an
appropriate licensed Stremio module supplies that behavior. This corrects the
overly narrow interpretation used in the initial spike.

### D-009 — Official local streaming service boundary

Torrent descriptors are converted by official Stremio Video through the
official Stremio Service loopback API at `127.0.0.1:11470`. The WebView CSP may
connect only to that fixed endpoint. The native player accepts only the
service's canonical hash/file playback path; arbitrary localhost URLs remain
blocked. Stremio Service is detected at runtime and is not silently installed,
started, linked, or bundled by this milestone.

## Non-negotiable boundaries

- The public Locadora repository remains unchanged and contains no playback,
  torrent, subtitle, debrid, or Stremio-account implementation.
- No secret-bearing manifest or playback URL may enter logs, fixtures, crash
  reports, analytics, screenshots, or Locadora services.
- Playback never changes a rental or watched state automatically.
- Normal accessible browsing remains fully functional without WebGL.
