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
- `player_start`, `player_load`, `player_control`, `player_events`, and
  `player_shutdown` — own one system-mpv session and expose only bounded player
  operations.

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

The system-mpv bridge:

- creates a unique per-session directory with mode `0700` under the app cache;
- launches mpv idle, quiet, and without a media descriptor in process arguments;
- transfers the descriptor only through mpv's private Unix IPC socket;
- accepts public HTTP(S) descriptors only—no `file:`, script, localhost, or
  private-network target from the webview;
- allowlists pause, resume, relative seek (at most 10 minutes), stop, event
  polling, and shutdown;
- emits only typed lifecycle/property events and never forwards mpv logs,
  filenames, response bodies, or URLs;
- closes mpv and removes its session directory when dropped.

The automated proof uses a generated FFmpeg/libav test source and null audio/
video output. It verifies `file-loaded` and `end-file` over the IPC channel;
it is not a claim of visual or public network playback. Playback remains
disabled in the UI until protected manifest configuration and the complete
candidate-to-player flow are connected.
