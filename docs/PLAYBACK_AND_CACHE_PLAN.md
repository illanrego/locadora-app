# Playback and cache repair plan

Historical milestone. Same-window embedding was subsequently implemented under
`EMBEDDED_PLAYBACK_PLAN.md`; the separate-window statements below describe the
earlier repair scope. Current work is in `STANDALONE_PLAYER_PLAN.md` and the
root progress ledger.

Requested 2026-09-26. Scope: desktop app only.

1. Restore artwork under the production security policy. Decode native image
   payloads locally, share shelf/inspection downloads, allow local blob images,
   and update tape textures without rebuilding the scene.
2. Move catalogue persistence to asynchronous IndexedDB, keyed by locale for
   details as well as shelves. Migrate old shelf records, retain bounded storage,
   and keep a session fallback when persistence is unavailable.
3. Improve the existing separate-window player: bounded mpv read-ahead and
   rebuffering, accurate loading/paused/buffering states, buffered time and a
   seek control. Keep source switching and cancellation available. Embedding mpv
   inside the application is a separate native-shell project, not claimed here.
4. Route external subtitles to the window actually playing the movie. Preserve
   official Stremio stream coordination, validate subtitle downloads through
   the bounded native network boundary, support selection/off and delay in
   consistent units, and expose loading/failure feedback. Subtitle lookup must
   not delay playback startup.
5. Add regressions for policy/artwork, locale persistence, buffering events and
   subtitle control. Run frontend/native checks, rebuild the executable used by
   `locadora`, and record results. User visual/playback acceptance remains open.

Implementation status: implementation, automated checks and native release
rebuild complete; user visual/playback acceptance pending.

Milestone 1 committed: artwork/policy, texture lifecycle and locale-aware
IndexedDB catalogue. Automatic sync is assessment-only; see
`AUTO_SUBTITLE_SYNC_FEASIBILITY.md`. Buffering/subtitle playback repairs pass
frontend and native tests, including real mpv IPC using a synthetic null-output
video. The current separate-window limitation remains explicit.
