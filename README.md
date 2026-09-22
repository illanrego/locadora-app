# Will's Locadora Player

Desktop Will's Locadora application with Locadora-owned discovery and member
state, a Stremio-compatible add-on boundary, deterministic Quick Watch rules,
and native playback planned through a narrowly scoped shell.

The implementation authority is `WILLS_LOCADORA_PLAYER_PLAN.md`. Current work
and the exact continuation point live in `IMPLEMENTATION_PROGRESS.md`.

## Local checks

```bash
npm install
npm run check
npm run check:native-core
npm run check:native
```

The browser build uses sanitized catalogue fixtures unless
`VITE_LOCADORA_PUBLIC_API_URL` is configured with a public discovery endpoint.
Media manifests and playback descriptors must never be committed or logged.

## Debian native prerequisites

Rust is installed through `rustup`. Tauri and the system-player spike require:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev mpv libmpv-dev
```

Build an optimized unpackaged executable with:

```bash
source "$HOME/.cargo/env"
npm run tauri -- build --no-bundle
```

See `docs/NATIVE_SECURITY.md` for the privileged command allowlist and network
boundary.
