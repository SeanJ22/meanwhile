# Session brief — 2026-08-14 (second session of 2026-08-14), as executed

The brief: "the pipeline proves itself and the map answers potholes."
Committed here as the record, with what happened to each item. Branch
`claude/pipeline-proof-and-potholes-0814`; full narrative in state.md
§18; walk record in docs/tester-pass.md.

**Dating convention change (this brief's own order, executed):**
state.md section headers now carry the REAL wall-clock date; §18 opens
with the note telling a stranger that §13–§17's date-shaped labels are
sequence numbers. Prior headers unchanged — history not rewritten.

## 1 — Reaction honesty (P11) — DONE, gate PASSED on the deployed site

The author's decided option two, built exactly: `submitReaction` returns
the outcome; the control renders selected-and-counted ONLY on the 204;
any non-204 (500, network failure, the never-happens 202) renders
"Couldn't reach the totals — your answer is saved on this device and
wasn't counted." Device-local record writes always. The search log
stays fire-and-forget by design, the difference in kind commented on
both sides. Tests pin all outcomes and renderings.

The gate: production's platform password was found DOWN, so the probe
ran against the real deploy — one tap (Hobbs card, YES,
2026-08-14T20:20:21Z) landed as a visible Neon row at 20:20:23Z.
Screenshot `walk0814b-production-tap.png`; row pulled by direct SQL.

The ledger: 4 reactions total — the author's two (17:24, 18:21 UTC,
matching the brief's facts) + this session's own two. **The tester has
tapped zero reactions.** Search log 359 rows; the tester's clean window
(18:32–19:40 UTC) holds 4 rows: the "my kids school" refusal, searches
at 07465 and 85701, and Gallego's card opened.

## 2 — The snapshot refuses to ship thin (D44) — DONE

`lib/funding/guard.ts` + wiring in `fetch-fec.mts` before the write:
candidate count below prior, a vanished candidate (absence recorded or
not — a human confirms either), or a retained candidate's contributor
rows below prior → exit 1, old snapshot kept, reasons in the workflow
log. `--allow-shrink` is the recorded human override. Fixture-tested on
the Kelly-504 shape; the mechanism asserted, never the absence of error.

## 3 — The everyday-topics map (A10) — DONE, verified against the pages

9 topics × 4 zips = 36 cells: 30 sourced contacts, 6 recorded misses,
0 silent (test-asserted). Every number read off the government's own
page — real browser where hosts wall plain clients. The verification
CHANGED the answers: Tucson's pothole owner answers through **Tucson
311** (the city's current page — the old TDOT line was not shipped);
07866 carries BOTH Rockaway governments (the registry covers the
Township; the draft cited only the Borough — caught mid-session);
Newbury's tax collector and transfer station got their dedicated lines,
and two 03255 misses resolved to contacts off the town's directory.
The hang-tight beat renders the author's words, never a thinking label;
route and log land before the timer. The refusal log drove two new
routes ("my kids school", "I want a bike lane" — both live refusals from
this morning). The pothole golden passes live at 85701.

## 4 — Scrub before store (T09) — DONE

`lib/log/scrub.ts` (7+-digit runs, email-shaped, street-address-shaped
→ `[#]`) at the single write path; fixture-tested; transparency page
discloses it in the same commit, coupling guard extended;
abuse-policy.md gained the typed-questions threat section, PENDING
COUNSEL.

## 5 — The photo census (D45) — DONE, count only

`scripts/photo-census.mts`: **16 of 747 rendered people have a
portrait** (ballot 8/109, federal 8/437, state legislators 0/130,
curated rosters 0/71). Named miss list in docs/photo-report.md — the
dedicated photo session's brief input. Nothing hunted, fetched, or
changed, per the author's order.

## 6 — Final pass — DONE

walk0814b green at all four zips at 390×844; tester-pass.md superseded;
tracker updated in place (P11, D44, D45, A10, T09 all Done with
evidence); next free ids A11, B11, D46, M46, P12, R13, T10, V07, X04;
transparency page verified in the walk at every zip.

## Carried out of this session

- **Production's password is DOWN** — the author should confirm that is
  intentional; T08 (hardening) was scoped to precede it.
- The incumbent-record-link modal would not open under this session's
  walk harness (hydration live, click dead; 0819 walked it green;
  nothing in this session touched it) — a thirty-second hand check is in
  the standing report's "Before you send the link."
- The photo session runs next with D45's list as its input.
