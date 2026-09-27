# Streaming engine artifact investigation — 2026-09-27

Current disposition: D-018 supersedes the historical blocker below. Locadora
bundles MIT-licensed `M0Rf30/stremio-server-go` v0.16.1, not official `server.js`.
Build-time SHA-256 pins and SBOM acquisition live in
`tools/prepare-streaming-engine.mjs`; lifecycle integration is in
`src-tauri/src/streaming_engine.rs`. The engine starts without Stremio installed
or running. Historical research below explains why the official server was excluded.

## Evidence

Official Service source inspected at commit
`1891799734acba88904f9f62cb8ca491873b36fb`:

- [Cargo.toml](https://github.com/Stremio/stremio-service/blob/1891799734acba88904f9f62cb8ca491873b36fb/Cargo.toml)
  describes wrapper version 0.1.22 and server version v4.21.1. Linux packaging
  contains `stremio-runtime`, `server.js`, `ffmpeg` and `ffprobe`.
- [build.rs](https://github.com/Stremio/stremio-service/blob/1891799734acba88904f9f62cb8ca491873b36fb/build.rs)
  downloads `https://dl.strem.io/server/v4.21.1/desktop/server.js`; it does not
  build the engine from the Service repository.
- [server.rs](https://github.com/Stremio/stremio-service/blob/1891799734acba88904f9f62cb8ca491873b36fb/src/server.rs)
  starts the runtime with `server.js` and supplies `FFMPEG_BIN`/`FFPROBE_BIN`.
  This establishes the wrapper's launch contract, not configurable port,
  readiness, private-cache or binding contracts of the downloaded engine.
- A Stremio organization member explicitly identified the main server module as
  closed source in [this reply](https://github.com/Stremio/server-docker/issues/27#issuecomment-1870556697).
  Another member [closed the issue in August 2025](https://github.com/Stremio/server-docker/issues/27#issuecomment-3161649829)
  confirming that answer. These are maintainer statements, not a redistribution
  license. The wrapper's GPL-2.0 declaration does not resolve that missing grant.

## Consequence and continuation

The earlier assumption that the whole official engine could simply be bundled
under the Service wrapper license was unsupported. No redistributable official
artifact or complete source-build alternative has been established by this check.
Do not fabricate a checksum/pin or mark milestone 1 complete.

Two paths remain: establish permission/terms for distributing the official server,
or assess a clearly licensed compatible engine while keeping official Core and
Video. A switch of engine needs the user's direction and compatibility review.
No maintainer has been contacted. No external Stremio fallback satisfies the
single-install goal. Milestones 2 and 4 depend on this decision; player UI work
in milestone 3 can proceed independently.

## Concrete alternative for evaluation

[`M0Rf30/stremio-server-go`](https://github.com/M0Rf30/stremio-server-go) is an
unofficial engine, now adopted under D-018. Its
[LICENSE](https://github.com/M0Rf30/stremio-server-go/blob/main/LICENSE), fetched
directly during this check, grants MIT rights (Gianluca Boiano, 2026). The
[README](https://github.com/M0Rf30/stremio-server-go/blob/main/README.md) claims
enginefs compatibility, including create, stats, Range streaming and settings.
It documents configurable HTTP/HTTPS ports and `APP_PATH`; the source module
requires Go 1.26. These are upstream claims, not Locadora integration results.

If approved for evaluation, pin its source and dependencies, audit the actual
loopback/origin configuration and disable unnecessary local-file, casting and
indexer features. Verify against our installed Stremio Video conversion requests
with synthetic media, including file selection, seeks, cancellation and shutdown.
Confirm dependency licenses and the FFmpeg packaging requirements independently.
This route keeps official Core/Video and replaces only the byte-serving engine;
do not describe it as official Stremio Service or as proven equivalent.
