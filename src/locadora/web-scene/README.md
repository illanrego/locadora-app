# Locadora web scene port

Source: read-only `locadora/public/immersive-shelf.mjs` and `vhs-case.mjs`,
2026-09-28. MIT copyright 2026 Illan Rego; the license is retained here.

The room geometry, physical shelves, VHS faces/spines, sign, fixtures, lighting,
wall posters, floor, camera framing, hover motion, keyboard/raycast selection,
zoom and touch gestures come from the web implementation.

Desktop adaptations:
- Import the installed `three` package rather than a web vendor URL.
- React exclusively mounts this full-window scene or the accessible 2D shelf.
- `ImmersiveShelf.tsx` maps canonical catalogue identities and callbacks, pauses
  the scene behind dialogs/playback, and restores 2D on WebGL context loss.
- Four artwork workers use the existing bounded native/public artwork cache.
  Local blob URLs update cases/spines incrementally; disposal revokes them and
  late results cannot attach to a newer scene. No web global URL helpers remain.
- Decorative posters use the first movie covers in the current desktop stand;
  the web-only featured endpoint is not called from the desktop.
- Native catalogue state supplies the selected stand; previous/next controls and
  keyboard boundaries navigate loaded stands or fetch the next page.
- Plaque genre/year drafts apply through IR/GO. Provider branding is omitted,
  consistent with the desktop product scope. Year bounds use the current year.

The adjacent declaration describes the narrow React-facing API. The scene stays
in JavaScript to keep comparison with the web source straightforward.
