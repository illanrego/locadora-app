# Will's Locadora Player

Desktop Will's Locadora application with Locadora-owned discovery and member
state, a Stremio-compatible add-on boundary, deterministic Quick Watch rules,
and embedded native playback through a narrowly scoped shell.

The implementation authority is `WILLS_LOCADORA_PLAYER_PLAN.md`. Current work
and the exact continuation point live in `IMPLEMENTATION_PROGRESS.md`.

For the current standalone-engine and modern-player work, continue with
[`docs/STANDALONE_PLAYER_PLAN.md`](docs/STANDALONE_PLAYER_PLAN.md). It records the
approved single-install requirement, implementation gaps, code map and milestones.
Linux x86_64 builds embed and supervise their own compatible streaming engine.
Stremio Desktop, Stremio Service and Node are not runtime requirements. The Debian
installer declares mpv/libmpv/FFmpeg and GTK/WebKit dependencies for installation
by the system package manager. Optional Stremio add-on import remains available;
you can also configure add-ons directly without installing Stremio.

## Local checks

```bash
npm install
npm run prepare:engine
npm run check
npm run check:native-core
npm run check:native
```

The browser build uses sanitized catalogue fixtures unless
`VITE_LOCADORA_PUBLIC_API_URL` is configured with a public discovery endpoint.
Media manifests and playback descriptors must never be committed or logged.

## Debian native prerequisites

These are **developer build prerequisites**, not separate end-user setup steps.

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

Build the Debian installer with `npm run tauri -- build`. Install its generated
`src-tauri/target/release/bundle/deb/*.deb` through the package manager (for
example `sudo apt install ./path-to-package.deb`) so dependencies resolve
automatically. The engine is downloaded/checksummed only at build time; the
installed app never downloads an executable. This delivery targets Debian-style
x86_64 Linux; Flatpak and other platforms remain pending.

See `docs/NATIVE_SECURITY.md` for the privileged command allowlist and network
boundary.
