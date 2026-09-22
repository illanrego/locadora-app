# Native boundary and security model

Last reviewed: 2026-09-22

The React application does not receive generic shell, filesystem, or native
HTTP permissions. Its Tauri capability grants `core:default` only. Custom Rust
commands are the complete privileged interface.

## Current command allowlist

- `native_capabilities` — reports whether system mpv is available and its short
  version line. It accepts no path, URL, or command-line argument.
- `fetch_addon_json` — accepts one manifest plus an allowlisted protocol
  resource (`manifest`, `meta`, `stream`, or `subtitles`). The native core
  constructs resource URLs itself.
- `fetch_public_shelf` — calls the fixed Locadora public API origin with bounded,
  validated genre/year/type/stand fields.

## Native network controls

`crates/native-core` enforces:

- HTTPS and no URL username/password;
- no localhost or private/reserved IPv4/IPv6 destination;
- DNS resolution before every request and pinning to the validated addresses;
- redirect disabled in the client and at most three manually revalidated hops;
- eight-second timeout;
- one-mebibyte body maximum, checked both from `Content-Length` and while
  streaming;
- generic errors that never reproduce a URL, token, path, hash, or response
  body.

Secret-bearing URLs remain in memory for the request. Protected at-rest storage
is not implemented yet, so the app exposes no UI that persists a manifest.

## Player boundary

The current command only proves system mpv capability. The playback bridge must
launch mpv without putting a playback URL in its process arguments, send media
descriptors through a private local IPC channel, bound every command, and erase
session material at shutdown. Until that bridge and protected manifest storage
exist, playback remains disabled in the UI.
