# Streaming engine artifact investigation — 2026-09-27

Milestone 1 status: blocked on the official engine's redistribution contract.
No engine binary/server bundle has been copied, installed or redistributed.

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
