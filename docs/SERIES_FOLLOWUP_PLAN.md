# Series follow-up — sources, series Quick Watch, progress UX and one UI fix

**Status:** owner-directed, planning complete, awaiting the first delegated part.
Decision entries D-031 (series identity/progress) and D-006 (series stay manual)
already exist; this document supersedes D-006's *playback* half and adds a new
entry covering the rest.

**Repository:** `/home/illan/Documents/coding/locadora-app` only.
`/home/illan/Documents/coding/locadora` stays read-only: none of this reaches
the web repo, and its Worker and Pages deployment are unaffected.

**Owner correction recorded:** Cinemeta's 15 episodes for Family Guy season 24 is
correct data, not an incomplete payload. Do not "fix" it, do not pad it, and do
not warn about it.

---

## 1. What this covers

Six parts, in dependency order:

| part | workstream | why |
|---|---|---|
| P1 | source normalization + series Quick Watch rules | series still cannot autoplay, and The Pirate Bay is being mislabelled |
| P2 | wire series rules into playback | the rules from P1 are inert until the player uses them |
| P3 | remove the duplicated genre/year picker in immersive mode | the 3D plaque and the "Buscar fitas" panel are two live copies |
| P4 | cache the episode list | 366 KB re-fetched on every tape open |
| P5 | Carteirinha structure from the web version, app styling kept | the app's block layout is worse than the site's; the continue-watching block lands here |
| P6 | episode UX in immersive mode and watched state on the tape | the picker was only designed for 2D |
| P7 | progress extras: next-episode offer, season marking, specials, episode art | the parts of "know where I am" that are still missing |

## 2. Verified facts the parts must work from

- **The Pirate Bay is mislabelled, not unranked.** `normalization.ts:68`
  returns `text(structured) || 'Other'` when no alias matches, and the TPB
  pattern is `\b(?:the\s+pirate\s+bay|tpb)\b` (`normalization.ts:14`) — it
  requires whitespace, so "ThePirateBay" (Torrentio's actual spelling) never
  matches. The candidate then ranks as an unknown name, and
  `sourceRank` (`quickWatch.ts:37-40`) gives unknown names `sourceOrder.length`,
  i.e. last. TPB *is* first in `MOVIE_QUICK_WATCH_V1.sourceOrder`
  (`quickWatch.ts:21`); the alias table is what fails.
- **Series never autoplay.** `selectQuickWatch` returns
  `series-requires-manual-selection` for `contentType === 'series'`, and
  `WatchFlow` additionally guards with `quickWatchEnabled && !episode`
  (added to enforce D-006). Both must move together or the change is inert.
- **Manual picker filter.** `filterSources()` takes
  `ResolutionFilter = 'all' | 'unknown' | 2160 | 1080 | 720 | 480`
  (`src/media/sourcePicker.ts`) — resolution values that make sense for a
  feature film and not obviously for a ~300 MB episode.
- **The duplicated filter is real.** `App.tsx:284` renders `browse-controls`
  whenever immersive mode has "Buscar fitas" open, and that block contains the
  genre `<select className="genre-picker">` and the year machine — the same two
  filters the 3D plaque owns and applies through `onConfigure`. 2D must keep
  them: it is the required accessible fallback.
- **The picker renders in both modes.** `App.tsx:455` renders `TitleInspection`
  regardless of mode, and the picker is a fixed panel
  (`.tape-episodes`, `styles.css:191`) that therefore appears over the 3D scene
  too — unverified for collision with the header actions, hence P5.
- **The episode list is not cached.** `fetchSeriesEpisodes()` runs on every
  inspection; Family Guy's payload is 366 KB / 511 videos.
- Cinemeta sends `thumbnail` and `overview` per video and a `released` date;
  `parseSeriesEpisodes` currently keeps `name` and `released` only.

## 3. Decided

- **Bundle and trust The Pirate Bay first.** It is number one in the trusted
  source order and must never fall to the unknown bucket.
- **Series episodes get their own size band: 100 MB–500 MB.** A season pack is
  multiple GB, so this band rejects packs by itself — no pack-specific check is
  needed for the primary path.
- **Both clocks stay separate:** the download/retention plan is a different
  feature and is not touched here.

## 4. P1 — source normalization and series Quick Watch rules

Scope, pure TypeScript only:

1. `SOURCE_ALIASES` gains spaceless and punctuated variants for the sources we
   name (`thepiratebay`, `the-pirate-bay`, `piratebay`, `tpb`), plus a small set
   of other commonly returned sources worth naming. Keep matching bounded and
   deterministic.
2. The unknown fallback stops being "Other" as a *name*: keep whatever the
   add-on actually said when it said anything, and only use a generic label when
   nothing at all is known. Ranking for anything unnamed stays last, explicitly.
3. `SERIES_QUICK_WATCH_V1` beside `MOVIE_QUICK_WATCH_V1`, same shape:
   - preferred resolution 1080p, fallback 720p;
   - per-episode preferred band 100 MB–500 MB;
   - a wider band for oversized episodes (proposed 500 MB–1 GB) as the second
     tier, and nothing above 1 GB is ever auto-selected;
   - minimum seeders for episodes: **20** (owner, §11);
   - `sourceOrder` identical to the movie list, The Pirate Bay first;
   - identical deterministic tie-break (seeders, source rank, smaller size,
     stable id).
4. `selectQuickWatch` takes the series config when `contentType === 'series'`
   and returns the same result shape, with reasons that name the series rule
   version. `series-requires-manual-selection` remains only for the case where
   no episode-appropriate candidate exists.

Exit criteria: table-driven tests for the alias table (every variant, and a name
that must stay unknown), the size-band boundaries (99 MB, 100 MB, 500 MB, 501 MB,
1 GB, above 1 GB), a season pack being rejected, and determinism across shuffled
input order. A movie's selection must be unchanged for every existing fixture
except where a TPB candidate was previously forced into the unknown bucket.

Must not: touch the player, the UI, the episode parser, or the progress store.

**Model: astra high.** It changes how an established, user-visible autoplay
decision is made and it edits the ranking path movies share — the definition of
tricky/risky for this repo.

## 5. P2 — wire the series rules into playback

- Remove the `quickWatchEnabled && !episode` guard in `WatchFlow` and let the
  series evaluator decide for episodes; a series still never autoplays a
  *title-level* stream (there is none).
- Resolution filter in the manual picker: default to the series preferred
  resolution for episodes, and keep the filter options meaningful for the band
  in use.
- Explanation copy (PT-BR + EN) for the new series reasons and for the
  pack-only case, in the existing `resolutionService` message vocabulary.
- Keep D-006's manual picker as the fallback whenever the series rules produce
  no winner — the picker is the safety net, not a legacy path.

Exit criteria: a series episode with qualifying candidates autoplays the chosen
episode; an episode with only season packs opens the picker with the pack
explanation; movies are unchanged; the `WatchFlow` test that asserts episodes
never autoplay is replaced by one asserting they autoplay *by the series rules*.

**Model: gpt-5.6-sol high.**

## 6. P3 — remove the duplicated immersive filter

- In immersive mode the "Buscar fitas" panel no longer renders the genre picker
  or the year machine; the plaque owns both. It keeps the title search.
- 2D keeps both controls unchanged, including the transactional apply path (one
  shelf load per interaction).
- Update the layout tests that assert which controls exist in which mode, in the
  same commit.

**Model: gpt-5.6-sol medium** — small, contained, but with test coupling.

## 7. P4 — cache the episode list

- New bounded store (or a keyed record in the existing database) holding parsed
  `SeriesEpisodes` per IMDb id, written on a successful fetch and read before
  it. Store the **parsed** shape, never the raw payload.
- Reuse the existing `CACHE_VERSION` prefix discipline and the `savedAt` index;
  bound the number of cached series and prune oldest.
- A cached list must be invalidated when the parser's own shape changes — the
  same version-prefix mechanism the title cache uses.
- Fetch failures must not overwrite a good cache entry.

Exit criteria: second inspection performs no fetch; a version bump ignores old
records; a corrupt record is ignored rather than trusted; the bound evicts the
oldest.

**Model: gpt-5.6-sol high** (IndexedDB schema discipline).

## 8. P5 — Carteirinha structure (web layout, app styling)

Owner direction: the web Locadora's Carteirinha is better *structurally* — how
the blocks are grouped, ordered and nested. Keep the desktop app's palette,
typography and visual style; take the web's diagram.

Reference (read-only, do not edit, do not copy its CSS): the site's
`account-dialog` markup in `/home/illan/Documents/coding/locadora/public/index.html`
around lines 318-387. Its block order is the target:

1. member card — monogram mark, username with an inline edit affordance, member
   since;
2. rental limit — select 1-10 plus its save action, the "applies to app and
   website / lowering does not return tapes" hint, and a status line;
3. a compact stats trio — rented tapes against the limit, recent records, saved
   items;
4. TV pairing action with its status line;
5. personal shelves side by side — watch later and favourites, each with a
   heading and an "open list" action;
6. active rentals as their own labelled section, with the counter return action;
7. history collapsed behind a disclosure, with a load-more action;
8. default streamings as their own section, with the "all streamings" option;
9. sign out last.

Rules:

- Structure, grouping, order and nesting come from the web; colours, fonts,
  spacing tokens and dark-blue identity stay the app's.
- The app has no provider filter and no TV pairing equivalent in this repo's
  scope — keep the blocks that exist, and say in the proof block which web
  blocks have no app counterpart rather than inventing one.
- This part also carries the **continue-watching block** (owner, §11): a
  "Continuar assistindo" shelf beside watch later and favourites, showing the
  series and its next episode label, opening the tape inspection. It reads
  local progress only and mutates nothing.
- Accessibility and keyboard flow must survive the restructure; 2D remains the
  required path.

Exit criteria: the app's Carteirinha presents the same block order and grouping
as the web reference; existing member actions (profile save, rental limit,
returns, reviews, history, sign out) all still work; the continue block shows
the right next episode for a series with progress and disappears when there is
none; the layout tests covering the panel are updated in the same commit.

**Model: gpt-5.6-sol high** (structural UI change on a live panel).

## 9. P6 — episode UX in immersive mode and watched state on the tape

- Verify and fix the picker's placement and collision in immersive mode
  (header actions, stand, plaque), keeping 2D unchanged and accessible.
- Watched state visible where the series appears, not only inside the picker
  (a small badge or marker on the tape/spine), without changing click targets or
  the packed-shelf geometry.

**Model: gpt-5.6-sol high** (layout risk in the 3D scene).

## 10. P7 — the rest of "know where I am"

Each of these is independently scoped inside P7; the run may land them together
only if its checks stay green:

- **Next-episode offer after `ended`** — offer, never autoplay, with the next
  episode's source resolved only when the offer is taken (owner, §11).
- **Mark a whole season watched** (and unmark), writing the same records.
- **Specials reveal**: season 0 stays hidden by default with an explicit way to
  show it.
- **Episode art and context**: keep `thumbnail` and a bounded `overview` from
  Cinemeta, show the air date we already parse, never store the raw payload.

**Model: gpt-5.6-sol high.**

## 11. Decided by the owner (2026-10-18)

1. **Minimum seeders for an episode: 20.** Stricter than the movie rule's 10,
   because episodes are small and plentiful.
2. **A finished episode offers the next one; it does not autoplay.** The offer
   resolves the next episode's source on demand, so an idle app downloads
   nothing and the offer is a single explicit action. This supersedes the
   episode half of D-006, which forbade any next-episode behaviour.
3. **"Continue watching" lives in the Carteirinha**, beside the existing
   watch-later and favourite previews (D-020's preview pattern), not on the
   shelf.

## 12. Delegation policy for this work

- One part per Codex run; never two runs against this repo at once.
- Model tiers, per the owner: **`gpt-6-astra` at high reasoning effort** only
  for P1 (ranking/alias changes on a shared path) and for anything else the
  owner later calls demanding, tricky or risky; **`gpt-5.6-sol` high** for P2,
  P4, P5, P6; **`gpt-5.6-sol` medium** for P3 (small and contained).
  **`gpt-6-sol` is not used** — an early Part 1 run burned tokens on it and the
  owner stopped it.
- Every brief carries: read order, this document's relevant part, the frozen
  facts from §2, the must-not list, and a proof block (`npm run check` tail with
  real counts, `git status` before/after, `git diff --stat`, commit hash, a
  walkthrough, and every choice the brief left open).
- Parts are sequential; a part starts only when the previous one's checks are
  green and its commit is in.

## 13. Not in scope

- **Episode stills — rejected by the owner (2026-10-19), not deferred.** Cinemeta
  serves them from `episodes.metahub.space`, the native image boundary stays
  TMDB-only, and the owner called the idea an overshoot. Do not re-propose it.
- Episode-level resume position — *now implemented* under D-033; this line is
  history, not scope.
- Season-level rentals or packs as a rental unit.
- Web/window parity for progress (the record stays server-shaped for it, §7.1 of
  the series plan).
- Anything from the rented-tape download/seeding plan.
