# Session brief — written by F01-continued for whoever comes next

**Written 2026-08-19 at the close of F01-continued.** This file is overwritten
every session; what it says is what the last session actually left behind, not a
plan.

---

## Where the tree is

`main` at **`d722605`**, which is what production is serving (`/api/build`) and
what the final `walk:all` ran against. **All the code shipped in `bd4b05b`
through PR #112 — ONE code merge.** The close-out records follow in their own
commit, which cannot name the SHA of the commit containing it; that is now
written into `CLAUDE.md` as the amended merge cadence rather than reported as a
deviation every session. Working tree clean, no open PRs, local `main`
fast-forwarded.

Gates at the close: **test 1281 pass / 0 fail · lint 0 errors, 11 allowlisted
warnings · `tsc --noEmit` clean · build green in default AND standalone ·
`walk:all` 332 passed, 0 regressions, 0 could-not-run** (baseline 324, added 8,
GONE 0).

---

## What this session was, and where it stopped

**F01-continued, items 1 through 11 of 17.** Items 1–7 were reconciliations of
F01's own report; 8–11 were reader-facing defects from the author's 2026-08-19
phone walkthrough.

**Item 12 is the first item not started.** Items 12–17 are untouched and the
next session is F01-continued again, in the same order, with nothing added:

* **12** — move the long sections (in their own words, campaign funding) off the
  inline ballot row and into the large battlecard, and add a full-width
  **View Battlecard** pill beneath the links row. People only.
* **13** — battlecard positions search returns nothing, including for terms in
  the positions the card holds. Diagnose before fixing, and verify against the
  post-11, post-12 state rather than against what shipped at `5253e5f`.
* **14** — the eleven-issue gap block: annotate and bury. The count on the
  ballot, the full enumeration inside the battlecard, the disclaimer clause
  travelling with the list wherever it appears.
* **15** — "Find your polling place" leaves the app; the map's "where to vote"
  pill does not. The pill's behaviour is the standard.
* **16** — New Jersey's in-person early-voting WINDOW has no add-to-calendar.
  **Confirmed while shooting item 8's screenshots**: at 07866 every single-date
  row carries "Add to calendar" and `10/24/2026 – 11/01/2026` carries none.
  Note before starting: `lib/calendar/event-links.ts` slices a UTC ISO string,
  which is item 16.4's timezone question sitting in the code already.
* **17** — the dummy address becomes `123 Main St, Anywhere, USA` everywhere.

---

## Three things that will look wrong and are not

1. **Issue-mention counts went DOWN product-wide.** 72 → 64, and eight
   candidates' counts moved, every one downward. That is item 11 working: the
   extraction was reading press-release rails and navigation as candidate speech,
   so the old number was partly measuring website software. It is a correction,
   not a regression, and `pnpm chrome:sweep` reprints the pair any time.
2. **The candidate corpus doubled to 96 documents with 0 revisions.** 30 of them
   are RE-EXTRACTIONS — the same pages read by a better extractor. The new
   `extractorVersion` field is what tells those apart from a campaign changing
   its position, and `currentExtraction` stops the older copy being searched
   beside its own successor. Do not "clean up" the older generation: the file is
   append-only on purpose.
3. **Kearsarge's meeting floor is no longer a number.** `least` is 2 — the
   durable half of the claim — and the real expectation is computed each run from
   the snapshot and the server's own window constants. A fixed floor over a
   moving back-window drifts by construction, which is how it went red under F01
   twice for a reason that was never a regression.

---

## Two traps this session paid for

* **A source file holding a literal NUL is invisible to `Grep`.** ripgrep calls
  it binary and skips it. `components/ballot/pick-control.tsx` carried two, on
  the ballot surface, where four of this brief's items live — so any class sweep
  run against this repo before 2026-08-19 did not see that file. Both pick
  surfaces build their store snapshots with `JSON.stringify` now, with no
  separator character at all.
* **Unit tests all passed on a fix the four-zip browser walk failed on every
  zip.** The clear's suppression was resolved against the reader's stored picks,
  so a contest holding both an explicit pick and a Yes re-derived the Yes the
  instant the file was emptied. `scripts/verify-picks-f01c.mts` is that walk; it
  refuses any base URL that is not localhost, because it taps a reaction.

---

## The standing close-out, unchanged

Every session ends with `pnpm walk:all` against the SHIPPED build, `pnpm
census:runs --target=production`, `pnpm stamp` into `state.md`, tracker rows by
ID with a duplicate check, `docs/session-map.md`, a playbook diff or an explicit
"nothing new", this file overwritten, and `pnpm handoff --ship`.

**Run `handoff --ship` WITHOUT corepack** (`pnpm handoff --ship`). Through
corepack the build gate cannot start — the packageManager pin refuses the newer
global pnpm — and the gate says so honestly rather than passing, which is the
gate working.

**New commands this session:** `pnpm names:census` (single-token person names
across everyone held) and `pnpm chrome:sweep` (the issue-extraction before/after
pair).
