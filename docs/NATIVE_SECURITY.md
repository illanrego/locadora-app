# Native boundary and security model

Last reviewed: 2026-09-27

## Standalone engine boundary (current)

`streaming_engine_ensure` launches only the checksum-pinned executable embedded
at build time. `streaming_engine_status` reports owned-child liveness.
`streaming_engine_request` bridges GET metadata and POST torrent-create requests
only at `http://127.0.0.1:11471`; no generic URL, settings-write, proxy or filesystem
API is granted. Requests are bounded, redirects/proxies disabled, responses capped
at 2 MiB and time-limited. Nested media probe URLs must reference a torrent file
on that same owned engine. Errors never include descriptors. This bridge avoids
relaxing upstream CORS for Linux's non-HTTP `tauri://localhost` origin.

Port conflicts fail closed. Readiness verifies the unique session appPath and
server API version. The app never adopts/kills an external Stremio process.
The engine binds loopback, uses a private session, stores pieces in bounded RAM,
and disables local-library/indexer/DLNA features. Exit reaps the owned process
group and removes its session; Linux parent-death signalling handles abnormal exit.
Upstream's built-in HTTP loopback and Stremio-web origin permissions still exist;
the control port is not authenticated against other processes of the local user.

The following original foundation notes describe the earlier IPC spike; current
playback is embedded libmpv and manifest configuration uses the OS keyring.
The additional loopback exception above supersedes the earlier blanket exclusion.

The React application does not receive generic shell, filesystem, or native
HTTP permissions. Its Tauri capability grants `core:default` only. Custom Rust
commands are the complete privileged interface.

## Current command allowlist

- `native_capabilities` — reports whether system mpv is available and its short
  version line. It accepts no path, URL, or command-line argument.
- `fetch_addon_json` — accepts one manifest plus an allowlisted protocol
  resource (`manifest`, `meta`, `stream`, or `subtitles`). The native core
  constructs resource URLs itself.
- `media_configuration_*` and `fetch_configured_addon_resource` — validate,
  store, summarize, use, remove, or delete compatible add-ons. A stored URL is
  selected by sanitized add-on ID and is never returned to the webview.
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
