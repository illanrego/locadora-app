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

Use React + TypeScript for the shared interface and pure engines. Use Tauri 2 as
the initial native boundary candidate, with a narrowly allowlisted Rust command
layer and an external/libmpv feasibility spike. This decision remains subject
to the Phase 0 license and platform proof; UI/domain code must not depend on
Tauri APIs directly.

## Non-negotiable boundaries

- The public Locadora repository remains unchanged and contains no playback,
  torrent, subtitle, debrid, or Stremio-account implementation.
- No secret-bearing manifest or playback URL may enter logs, fixtures, crash
  reports, analytics, screenshots, or Locadora services.
- Playback never changes a rental or watched state automatically.
- Normal accessible browsing remains fully functional without WebGL.

