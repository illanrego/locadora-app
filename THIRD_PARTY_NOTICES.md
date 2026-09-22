# Third-party dependency and license inventory

Reviewed: 2026-09-22

This inventory is an engineering aid, not legal advice. The build also emits
`dist/third-party-licenses.md` from installed JavaScript package metadata.
Packaging work must refresh this file from the final dependency graph.

## Direct application dependencies

| Component | Intended use | Upstream license | Distribution note |
| --- | --- | --- | --- |
| React / React DOM | Shared interface | MIT | Retain notices in binary distributions. |
| Three.js 0.185.1 | Optional immersive Locadora shelf | MIT | Lazy-loaded only for immersive mode; retain the Three.js license notice. |
| Will's Locadora web modules | Visual constants and immersive shelf interaction reference | MIT, copyright Illan Rego | Genre themes, rack dimensions, camera/lighting values, plaque treatment, and interaction contracts were ported into React/TypeScript; the source repository remains unchanged. |
| Vite | Build tool | MIT | Build-time only; generated license report is enabled. |
| TypeScript | Type checking | Apache-2.0 | Build-time only. |
| Vitest | Automated tests | MIT | Development only. |
| Testing Library / user-event | DOM interaction tests | MIT | Development only. |
| jsdom | DOM test environment | MIT | Development only. |
| Tauri 2 | Native application boundary | MIT OR Apache-2.0 | Candidate shell; final Rust graph must be audited. |
| reqwest + rustls | Bounded native HTTPS transport | MIT OR Apache-2.0 | Redirects are manually revalidated; TLS uses platform-verifier-backed rustls. |
| keyring-rs | OS-protected media configuration | MIT OR Apache-2.0 | Stores secret-bearing manifest configuration through the platform credential service. |
| Stremio Core | Add-on types, compatibility, transport, and response parsing | MIT | Linked from the official repository at pinned revision `b3062f7fa790223540022f9a62c12067b646c179`; retain its license and notices. |
| Stremio official add-ons | Transitive Core data dependency | MIT | Version 2.1.2 through the pinned Core dependency. |
| Stremio local-search | Transitive Core search dependency | MIT | Cargo locks the resolved official repository revision. |
| Stremio add-on protocol | Compatible HTTP contract | Documentation/protocol | Requests and responses are now handled by official Stremio Core over the bounded native environment. |
| Stremio Video 0.0.98 | Official frontend player abstraction and ShellVideo state model | MIT | Used beneath Locadora's React presentation through a narrow Tauri/mpv shell transport. |
| Stremio libass-wasm 4.2.6 | HTML subtitle rendering used by Stremio Video | LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0 | Shipped as a transitive browser asset; preserve the generated license inventory and source/notice obligations. |
| Stremio hls.js fork 1.5.5 canary | HLS playback support used by Stremio Video | Apache-2.0 | Transitive browser dependency. |
| vtt.js 0.13.0 | WebVTT parsing used by Stremio Video | Apache-2.0 | Transitive browser dependency. |
| Stremio Service | Optional local torrent/stream conversion runtime | GPL-2.0 | Interoperated with over its fixed loopback HTTP API. It is currently separately installed and is not linked or bundled. |
| mpv / libmpv | Native playback candidate | GPL-2.0-or-later by default; an LGPL-2.1-or-later build mode exists with caveats | Initial spike targets a separately installed system mpv. No mpv binary is bundled. Packaging remains blocked on a final license/build review. |

## Explicit exclusions

- No Stremio Web visual UI code is copied. Its frontend media behavior is a
  reference for connecting official Core/player modules beneath Locadora's UI.
- No Stremio `server.js` distribution is included.
- No code from a repository without a clear license is included.
- No third-party credentials, manifest URLs, or playback URLs are included.

## Evidence sources

- Tauri architecture and license: <https://github.com/tauri-apps/tauri/blob/dev/ARCHITECTURE.md>
- Stremio Core license: <https://github.com/Stremio/stremio-core/blob/development/LICENSE.md>
- Stremio Video license: <https://github.com/Stremio/stremio-video/blob/master/LICENSE>
- Stremio Service license: <https://github.com/Stremio/stremio-service/blob/master/LICENSE.md>
- Stremio add-on protocol: <https://stremio.github.io/stremio-addon-sdk/protocol.html>
- mpv licensing modes and limitations: <https://github.com/mpv-player/mpv/blob/master/Copyright>
- Vite generated license inventory: <https://vite.dev/config/build-options.html#build-license>

## Current conclusion

The original source in this repository is MIT-licensed. Official Stremio Core
and Stremio Video are MIT dependencies, so the Locadora UI and deterministic
Quick Watch rules can remain MIT. Tauri is compatible with that choice. Public
binary distribution is not approved yet: the transitive libass/WASM bundle,
native mpv, FFmpeg/codecs, WebKitGTK, installer, and Flatpak dependency
obligations must be reviewed against the final packaged artifacts first.

## Locally verified native versions

The 2026-09-22 Debian build used mpv 0.35.1, libmpv 2.0.0, WebKitGTK
2.50.6, GTK 3.24.38, Rust 1.98.1, Tauri 2.11.x, and reqwest 0.13.5. These
versions describe the local proof only and do not yet define redistributed
binary contents.
