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
```

The browser build uses sanitized catalogue fixtures unless
`VITE_LOCADORA_PUBLIC_API_URL` is configured with a public discovery endpoint.
Media manifests and playback descriptors must never be committed or logged.
