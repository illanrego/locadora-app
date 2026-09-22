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

Local compatible add-on manifest URLs remain available. Linux can also import
the installed official Stremio collection from its read-only browser storage,
without copying Stremio login, cookies, history, or account data. Stremio
account synchronization is deferred. Browsing never requires either Locadora
or media login.

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

### D-010 — Desktop Locadora session boundary

The desktop app reuses the existing Better Auth and private member-Worker
contracts through fixed, native-allowlisted HTTPS endpoints. Its bearer token is
stored in an OS-keyring service/account distinct from media configuration and is
never returned to the React layer. Browser builds remain anonymous, member
login stays optional until participation, and local logout succeeds even when
the remote sign-out request is unavailable.

### D-011 — Installed Stremio collection import

The desktop app may read only fixed official Stremio local-storage locations
and the exact add-on collection key. It reconstructs the newest live LevelDB
record with a read-only parser, validates every transport and official Core
manifest, and replaces Locadora's separate protected media configuration only
after at least one safe add-on is found. It never reads Stremio cookies or
copies its auth key. Catalog-only add-ons may be retained and shown for parity,
but Locadora exposes only stream, subtitle, and metadata resource requests.

### D-012 — Production bundle shim for Stremio Video's WebVTT parser

`@stremio/stremio-video` requires `vtt.js` for HTML subtitle rendering, and that
package ships script-style files whose UMD footer publishes its API on a
top-level `this`. In ES module output the bundler substitutes that `this` as
`undefined`, so the production bundle threw while evaluating and the desktop
window stayed empty. Locadora keeps the official dependency unmodified on disk
and applies a narrow build-time transform (`tools/vttGlobalShim.ts`) that passes
the real global to that footer for `node_modules/vtt.js` only. Development mode
was unaffected, and no runtime behavior of the parser changes.

## Non-negotiable boundaries

- The public Locadora repository remains unchanged and contains no playback,
  torrent, subtitle, debrid, or Stremio-account implementation.
- No secret-bearing manifest or playback URL may enter logs, fixtures, crash
  reports, analytics, screenshots, or Locadora services.
- Playback never changes a rental or watched state automatically.
- Normal accessible browsing remains fully functional without WebGL.
