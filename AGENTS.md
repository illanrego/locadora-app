# Will's Locadora Player agent rules

## Scope

This repository is the desktop Locadora player described in
`WILLS_LOCADORA_PLAYER_PLAN.md`.

- Make changes only in `/home/illan/Documents/coding/locadora-app`.
- `/home/illan/Documents/coding/locadora` is a read-only visual and API-contract
  reference. Never edit, format, install into, commit, or otherwise mutate it.
- Never add real add-on manifests, playback URLs, tokens, cookies, credentials,
  or debrid configuration to source, fixtures, logs, screenshots, or commits.
- Locadora browsing/member state and media/player state must remain independent.
- Three.js/immersive browsing is an enhancement. The accessible 2D shelf is the
  required fallback.

## Start or resume work

Read these files in order:

1. `WILLS_LOCADORA_PLAYER_PLAN.md` — product and delivery authority.
2. `IMPLEMENTATION_PROGRESS.md` — current checkpoint, next task, and known risks.
3. `docs/DECISIONS.md` — accepted and provisional decisions.
4. `THIRD_PARTY_NOTICES.md` — dependency and license inventory.

Before changing code, run `git status --short` and preserve unrelated work.
Work from the single `Next task` named in `IMPLEMENTATION_PROGRESS.md` unless the
user changes priorities.

## Progress protocol

- Keep changes milestone-sized and commit after the relevant automated checks
  pass.
- Update `IMPLEMENTATION_PROGRESS.md` whenever a milestone changes state, a
  decision is made, a blocker appears, or before ending a long work session.
- Record exact check commands and results; do not claim manual visual/playback
  verification unless the user performed it.
- Leave one concrete `Next task`, plus enough file/contract detail that a fresh
  context can continue without reconstructing the session.
- Do not mark a delivery phase complete until all of its exit criteria are met.

## Implementation constraints

- Prefer pure TypeScript modules for identity, normalization, ranking, subtitle
  language handling, fingerprints, and redaction so they can be exhaustively
  tested outside the UI/native shell.
- Treat manifests and add-on responses as untrusted, bounded input.
- Native IPC is deny-by-default and command-allowlisted.
- Movie Quick Watch uses the versioned rules in the plan. Series remain manual
  selection until episode rules are approved.
- Playback events must never mutate rentals, return state, collections, reviews,
  or donations.

