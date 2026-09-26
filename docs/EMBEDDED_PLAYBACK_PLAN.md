# Embedded playback — 2026-09-26

User priority: play within the existing Locadora window, with the app's UI
around the movie; fullscreen hides that chrome.

1. Use the installed libmpv render API, not a second top-level video window.
   Retain the bounded IPC controls/events, native subtitle delivery, buffer
   policy and official Stremio stream coordination.
2. Mount a GTK GLArea in the main window. Keep native geometry aligned with the
   React video frame, including resize, scrolling and display scale. Create the
   render context before accepting a load; free it before destroying mpv.
3. Add an integrated Locadora playback layout, fullscreen/Escape, keyboard
   controls, seeking, audio and subtitle/sync controls. Fullscreen is video-only.
4. Verify native lifecycle and frontend geometry/fullscreen contracts, rebuild
   the executable used by `locadora`, and commit the milestone. Manual visual,
   GPU and configured-source playback acceptance remain with the user.

No automatic subtitle sync is included in this work. Public distribution still
requires the final dependency/license review; system libmpv is now linked.

Implementation status: native/frontend implementation, automated checks and
optimized build complete; user visual/GPU/configured-source acceptance pending.
