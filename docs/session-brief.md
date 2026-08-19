# Session brief — written by g20, 2026-08-19

Read `CLAUDE.md` first. Everything below sits under it.

---

## What g20 was, in one line

The deferred queue, items 1 through 9: **six addressed, one hunted to a
boundary and correctly not built, two never reached**. Shipped as `026f48e`.

---

## THE FIRST INSTRUCTION, and g20 is the evidence for it again

**Verify before building. Read the tree. Re-measure the number.**

g19's brief said this because four of its items were already built. g20's
version of the same lesson is sharper, and it is worth the top of this brief:

**Four separate numbers turned out to describe something other than what they
were being read as.** None was a lie. Each was a real measurement in the
wrong frame, and three of the four had already been quoted forward into a
brief as fact.

1. **The client ceilings.** The brief asked g20 to restore ceilings g19 had
   apparently moved off the committed figures — and to treat
   "measured-plus-300,000" as a violation of the ceiling rule. Nothing had
   moved. `scripts/bundle-budget.json` has not been touched since g18. The
   postbuild check prints KB: `3,100,000 / 1024` is `3027.3 KB`, and
   `940,000 / 1024` is `918.0 KB`. Both were read back out of the display as
   byte figures — one multiplied by 1000, one by 1024. **A whole session-brief
   correction came out of a rounded display.** The check now prints exact
   ceilings beside the KB line, because the measurement already printed its
   own exact bytes and the ceilings did not, and that asymmetry was the trap.
2. **B14's denominator.** The brief said 101 of 136 ballot candidates carry
   no photo, blurb, contact or link. Measured from the ballot itself: **75**.
   `pnpm b14:coverage` now exists so the next session measures rather than
   quotes.
3. **D29's arithmetic.** The brief's 27 + 30 = 57 quoted g18's superseded 30
   against g19's 27. g19 had already corrected 30 to 29 in the row and in the
   code. Re-derived here against all 56 live Clerk pages: **27 + 29 + 0 = 56**.
4. **The photo census.** 110 portraits shipped and the rendered count did not
   move — 591 of 750 before and after. 0 of the 110 sit on a covered
   division. The census counts people the product RENDERS (750); the manifest
   counts people we hold a portrait for (900). Different denominators.

**If you take one thing from this brief:** before acting on a number a brief
hands you, find the instrument that produced it and read what it actually
measures. Three of these four were one step from being acted on.

---

## Where the queue stands

* **Tracker 369 rows · 285 done or absorbed · 84 open** (79 after Tabled and
  Standing). No duplicate IDs.
* `pnpm deferred` still REFUSES to regenerate, correctly — `docs/deferred.csv`
  carries 75 author dispositions the tracker does not hold. The open count
  above was computed from the tracker directly rather than by moving the
  marked file aside, because the number was what was owed and the
  dispositions were not worth risking for it.

---

## What is genuinely open, in the order g20 would take it

1. **Item 7, untouched** — M123 (the six Kearsarge towns; the rung table is
   already in `docs/zip-playbook.md` and is the spec) and H03 (the re-walk
   cohort; enumerating the prior failures is itself the first step, and it
   does not need H01). Neither was started.
2. **Item 8, untouched** — M81 (the jurisdiction badge; `bodiesAt()` already
   does the point-in-polygon, so this is a call plus a label, and the design
   question to settle first is what a null-`ocdId` body renders) and D47.
3. **D52 (item 4)** — the NH retrieval is hunted and banked, no adapter
   written. **The next rung is named**: the API host is
   `https://cfsapi.sos.nh.gov/api`, found in the lazy chunks; it exposes no
   swagger, and its endpoints come out by driving the site's own search UI in
   a live browser and watching the calls. **Do not spend rungs 3 and 4 on an
   `nh.gov` state host** — see the playbook.
4. **B19 (item 5)** — not built, and the hunt found that the row's spec is
   wrong for two of three states. Arizona runs VOTE CENTERS; there is no
   "their polling place" to pin. Author question, in Needs your hands.
5. **B14's remainder** — 75 candidates have no site in our records at all,
   and the next rung is finding one. `CLAUDE.md`'s
   campaign-that-lives-on-Facebook rule is its shape.
6. **D50's remainder** — the RENDERED gap is 159 and is unchanged: ballot
   candidates 34/109, state legislators 94/130, curated local rosters 23/71.
   That is where a session aiming at 750 has to work, and it is NOT the
   cohort g20 cleared.

---

## Things g20 did that the next session should know about

* **`walk:all` grew by 3 and lost nothing.** 309 checks, baseline 306. The
  three hotfix-0817 carried-row checks used to report CANNOT-RUN whenever the
  refresh reached every source — a suite shrinking because the product got
  better. They assert the healthy state now, and it is a stronger claim: no
  rows carried AND no source reported a gap, which must agree.
* **The same shape, twice more.** `tests/doc-dates.test.ts` asserted
  `suspicious >= 1` and `readAllowlist` threw on zero entries; both fired on
  the day R16's residue finally aged out. And the pre-commit hook kept a
  PRIVATE COPY of the allowlist parser — the very duplication its own header
  says would guarantee drift. All three fixed, one parser now.
* **The date allowlist is EMPTY**, which is the check at full strength.
* **New sources and stores**: `lib/sources/prl/` (PRL rhetoric, CC BY,
  537/537 by bioguide), `lib/candidates/` (statement corpus, issues,
  positions, blurbs), `data/candidates/corpus-2026.json`,
  `data/prl/prl-profiles.json`. New commands: `pnpm prl:fetch`,
  `pnpm candidates:fetch`, `pnpm b14:coverage`.
* **Rung 11 is wired in.** `scripts/fetch-candidate-corpus.mts` asks the
  Internet Archive automatically on any non-OK response and records what it
  found beside what the live host did.
* **A revision detector must hash TEXT, not bytes.** The corpus fetch
  reported 14 revisions five minutes apart — pages carrying a nonce or a
  build timestamp. A signal that fires constantly cannot carry the thing it
  is for.

---

## Standing constraints g20 operated under

* **`outputs/` is gone.** The constraint is retired and the ship gate passed
  normally, exactly as the brief predicted.
* **F01 is parked whole.** `docs/Feedback 8.18 1421 pm.docx` is still IN the
  repo — the brief said the author had removed it. It was not opened, listed
  or referenced, and the Drive "Screenshots from Feedback" folder was not
  touched. Named here because the brief's premise and the tree disagree.
* **The organic census is closed as a question.** `search_log` organic is
  **107**, unchanged from g19, **delta 0**.
* `context.md`'s cap is **40 KB**; it is at 25.5 KB.
* Ceilings move only on proof. They did not move this session, and they had
  not moved in the one before it either.
* The one sanctioned write path is `WTP_PRODUCTION_DATABASE_URL_WRITE`.

---

## The playbook grew by five entries

`docs/zip-playbook.md`, all from real walls:

1. A New Hampshire STATE host is a different wall from a municipal one —
   `governor.nh.gov`, `council.nh.gov` and `cfs.sos.nh.gov` all refuse rungs
   2, 3 AND 4, and rung 6 clears them. Newbury falling at rung 4 does not
   generalise.
2. Rung 11 is cheap and should be wired in, not walked by hand.
3. **A 405 from a single-page app is NOT evidence that a route exists.** Five
   invented `/api/…` paths returned 405; all five returned 200 with the SPA
   shell to a GET. Five plausible endpoint names were one step from being
   written down as findings.
4. An SPA's API base lives in the LAZY chunks, not the main bundle.
5. A cross-origin API host needs the tab NAVIGATED to it, not fetched from
   the page — "Failed to fetch" is CORS and says nothing about the server.

---

## Needs the author, carried forward

* **B19's spec** — three states, three polling models. The pin has to become
  SITES, or the row has to say which model a jurisdiction uses.
* **D52's per-state mapping tables** — the gate has not moved and was not
  approached.
* **Two new external sources proposed, not added**: permit and
  zoning-application systems (A03's remainder) and the Vote Smart Political
  Courage Test (D05's). Both are `CLAUDE.md`'s "Ask before".
* **Two portraits held back** by the never-wrong-face gate — Brian Taylor and
  Bob Harb, both distance shots. One line reinstates either.
