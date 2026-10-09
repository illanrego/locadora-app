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

Historical milestone boundary, superseded by D-016 for delivery requirements.
The fixed endpoint below still describes current code until D-016 is implemented.

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

### D-013 — Local-first catalogue and bounded artwork cache

The desktop Locadora catalogue persists stable title metadata and artwork URLs
locally after the first successful shelf/detail response. Cached shelf pages and
complete inspection records are reused without a network request. Posters are
stored in a bounded local artwork cache for shelf browsing; backdrops are cached
only when a tape is inspected and have a smaller bound. Streaming-provider
availability is not part of the tape presentation. Catalogue refresh remains an
explicit future operation, while member and media-engine requests stay remote.
Inspection artwork crosses a native, TMDB-image-only boundary and reaches the
WebGL canvas as local blob data; it does not depend on browser CORS or a Worker
origin allowlist.

### D-014 — Separate-window subtitle rendering and buffer policy

Until playback is embedded, downloaded subtitles render in native mpv. The
HTML subtitle overlay cannot display over a separate native window. A bounded
HTTPS subtitle fetch validates public destinations/redirects, accepts at most
2 MiB of SRT/VTT/ASS-like text, and writes only into the private player session.
Selection tokens reject stale downloads after another selection/load/stop.
Only the latest 16 temporary files are retained; session shutdown removes them.
Stremio Video continues to own stream resolution and embedded-track controls.
Both external and embedded delay controls use milliseconds in React and seconds
at mpv's boundary. Delay persistence uses video/file identity, never source rank
or changing seeder descriptions; unknown torrent file identity is session-only.

mpv reads ahead toward 60 seconds, bounded by 128 MiB forward/32 MiB backward
demuxer caches, and targets 5 seconds before resuming from a cache pause. These
are targets, not bandwidth guarantees or a cap on the whole process's memory.
Automatic synchronization remains a feasibility proposal only.

### D-015 — Embedded Linux video surface

Linux playback uses the installed libmpv client and OpenGL render APIs inside a
GTK GLArea layered into Tauri's existing main window. React reports the bounded
video-frame geometry; the native widget draws only there and leaves Locadora's
controls in the WebView. As of the 2026-09-29 fullscreen correction, the GTK
stack is an opaque black base, native video, then a transparent WebView. React
owns scoped transparency only while Watch is mounted, hiding the catalogue
beneath it and restoring normal backgrounds on close. Stremio's ancestor
background mutation stays bypassed via `appOwnsVideoBackground`.

Fullscreen uses the complete native window regardless of control/panel
visibility. The compact strip and right-side drawer paint above the picture;
they do not resize it. Windowed playback still follows the app-owned frame.
Bounds reports identify their presentation mode; a fullscreen report cannot
be reused after restoring the window. Native window state overrides stale
windowed measurements on entry. Controls retain activity auto-hide and
keyboard/panel retention. Escape restores the windowed Locadora layout.
Source resolution remains owned by official Stremio
Video, while existing IPC continues to own bounded controls, events, buffering
and subtitle delivery. No second mpv process or top-level playback window is
created in embedded mode.

The outer React frame owns geometry; Stremio may mutate only the inner host.
This avoids its HTML subtitle wrapper changing the measured surface to a
zero-height relative-positioned element.

The GL render context is created and destroyed on GTK's main thread and is
released before libmpv and before the application window. X11 resolves OpenGL
through GLX and Wayland through EGL. Geometry and fullscreen events contain no
playback descriptors. Windows will need its own native render adapter in Phase
7; this decision applies to the current Linux build.

Tauri 2.11's Linux WebView installs an undecorated-resize click handler that
assumes the original `WebView -> GtkBox -> GtkWindow` ancestry even for a
decorated window. The embedded overlay necessarily changes that ancestry, and
the upstream handler panics before checking whether decorations make it a
no-op. Locadora patches the pinned `tauri-runtime-wry` 2.11.4 dependency so
both its mouse and touch handlers return normally when the expected GtkWindow
downcast is unavailable. This keeps Wry's separate synthetic back/forward mouse
handler installed and follows the fallible-downcast behavior in Tauri's current
development source. Native GTK decorations continue to own window resize and
WebKit's normal event dispatch remains intact.

### D-016 — One-install standalone application

Accepted 2026-09-27. Locadora must supply and supervise the official streaming
engine and its runtime dependencies. End users must not install or run Stremio
Desktop, Stremio Service, Node or mpv separately. This supersedes D-009's external
service detection as a delivery solution. Bundling/startup is now authorized,
subject to establishing the exact artifact's redistribution/build requirements.

Use an app-owned engine process with bounded readiness/recovery, isolated storage
and ownership-aware shutdown. Endpoint selection, CSP and native playback URL
validation must agree. Reuse official Core/Video behavior and preserve the narrow
platform adapter. An existing Stremio installation may support optional add-on
import but cannot be required for playback. D-018 refines the engine choice; see
`STANDALONE_PLAYER_PLAN.md` for milestones and acceptance criteria.

### D-017 — Modern Locadora playback presentation

Accepted 2026-09-27. Redesign the player around the video, compact transport
controls and secondary audio/subtitle/source panels. Use restrained dark blue
chrome and Locadora border details with readable contemporary typography. Keep
same-window native rendering, video-only fullscreen, accessible keyboard controls,
buffering/retry feedback and immediate subtitle delay adjustment. Respect native
GTK/WebView stacking when designing overlays. This is approved work, not a claim
that the current Watch UI has been redesigned. Automatic subtitle sync remains
assessment-only under `AUTO_SUBTITLE_SYNC_FEASIBILITY.md`.

### D-018 — Bundled compatible engine

D-018 (2026-09-27): the user's renewed instruction to implement the whole
standalone app authorizes the compatible-engine route. Pin MIT-licensed
`M0Rf30/stremio-server-go` v0.16.1 for Linux x86_64; retain official Stremio
Core/Video. This refines D-016's byte-serving component: it is an unofficial
compatible engine, not the closed-source official server. Download/verify only
at build time, embed the engine in the executable, supervise an owned loopback
process at port 11471, and never adopt/terminate a separately running Stremio.
Development and packaged builds must use the same startup path. Distribution
includes engine license/provenance/SBOM; no Node or Stremio install is required.

### D-019 — Full-window immersive parity and subtle fullscreen controls

Accepted 2026-09-28 by direct user request. Immersive mode replaces the normal
2D browsing page. Adapt the existing MIT Locadora web room/VHS scene locally,
retaining geometry, lighting, plaque, camera and interaction behavior; keep the
web checkout read-only. Desktop catalogue identities and cached native artwork
remain authoritative. Maintain accessible controls and automatic 2D fallback.
Fullscreen uses a compact neutral transport strip without the windowed title
header or routine buffer status. Activity auto-hide and secondary player panels
remain. The 2026-09-29 D-015 composition correction supersedes the earlier
space-reservation workaround: fullscreen controls now paint above native video.

### D-020 — Shared account rental limit and compact membership previews

Accepted 2026-10-06. User chooses 1–10 simultaneous active titles in desktop or
web Carteirinha, default 3. This supersedes the fixed three-title rule. The member
profile is authoritative; SQL serializes renting against profile updates and
enforces the chosen limit. Lowering it never returns existing rentals. Desktop
and web retain all active entries and block additional rentals when at/over the
limit. The user authorized changes to the web/backend repository for this work
and will run its production SQL migration manually.

Carteirinha previews show three watch-later and three favorite titles, with
explicit navigation to complete lists. Playback remains independent.

### D-021 — Desktop 2D presentation becomes the web styling reference

Accepted 2026-10-06. Bring the desktop navy header, bright brand colors, labelled
header actions and shelf spacing to web normal mode. Keep immersive scenes and
web provider/member contracts independent. Remove desktop shelf search and web
header search; retain the separate web Counter catalogue search.

### D-022 — Nonblocking GTK video timing

Embedded mpv rendering disables target-time blocking to keep GTK responsive.
Pair that with `video-timing-offset=0`, as required by mpv's render API when the
caller does not wait for the target time itself. This fixes premature frame
presentation, not a verified diagnosis of every source-dependent audio/video
hiccup. Playback acceptance and any source-specific cache/decoder diagnosis
remain separate from the option regression test.

Reference: [mpv render API timing contract](https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h),
`MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME`; also checked against installed
`/usr/include/mpv/render.h`.

### D-023 — Network buffering reserve

Accepted 2026-10-06 after the user requested resilience to uneven internet.
Supersedes D-014's five-second resume and 128 MiB forward-cache policy.
Use one native policy for embedded and diagnostic child playback: automatic
initial/underrun cache pauses, 15-second resume target, explicit 120-second
cache/read-ahead target, 256 MiB forward and 32 MiB backward ceilings. EOF or
reaching the byte ceiling may resume earlier, as defined by mpv. Explicit
`cache-secs` avoids its default overriding `demuxer-readahead-secs`. This is
bounded RAM buffering, not persistent media storage. mpv owns recovery so user
pause remains independent; do not add frontend timers that force play.
Show a localized recovery overlay over loaded video, including fullscreen;
remove it when recovery completes or the user pauses. Engine settings remain
unchanged: the bundled compatible Go engine is not identical to desktop
Stremio's engine. This mitigates brief starvation; it does not establish the
reported source's root cause or guarantee playback below sustained bitrate.

Reference: [mpv cache options](https://mpv.io/manual/stable/#cache).

### D-024 — Desktop person stands

Accepted 2026-10-09 by the owner priority change. Person stands are now the
active desktop catalogue milestone; the source-dependent network-buffering
investigation is paused pending the owner's playback retest. Clickable title
credits use TMDB person ids; cached title records without ids retain plain
names. Person roles aggregate job counts by department, and a stand filters
only by department (`job=`), always requests `type=all`, and keeps the year
window disabled (`ignoreStoreYear=true`). The desktop has no provider
preference, so it sends `providers=` from the first request. The empty-stand
action repeats the unfiltered request without changing any saved preference.
The same stand pages feed both the 2D and immersive shelves, with 2D remaining
the required fallback. The immersive plaque shows the person stand label and
offers the same sort choices as the 2D browse controls. Sorting is a local
browse preference applied by Ir and sent to aisle and person-stand requests;
changing browse filters returns to the aisle. Public metadata calls use fixed native routes to the existing Locadora
Worker origin; no member or media state participates.

## Non-negotiable boundaries

- The public Locadora repository remains unchanged and contains no playback,
  torrent, subtitle, debrid, or Stremio-account implementation.
- No secret-bearing manifest or playback URL may enter logs, fixtures, crash
  reports, analytics, screenshots, or Locadora services.
- Playback never changes a rental or watched state automatically.
- Normal accessible browsing remains fully functional without WebGL.
