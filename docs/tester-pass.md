# Tester pass — 2026-08-14 (second session of 2026-08-14), phone width, walked as a stranger

Supersedes the 2026-08-19 pass. This session's changed surfaces walked at
390×844, cold entry through the welcome overlay, all four zips. Driver:
`scripts/tester-walk-0814b.mts` — the PASS/FAIL logs below are its output
verbatim; screenshots `screenshots/walk0814b-<zip>-*.png`. Dating note:
this document is headed with the REAL wall-clock date (the convention
change recorded in state.md §18) — prior passes' date-shaped labels are
session sequence numbers, not dates.

**31 checks green across the four zips; the only console error is the
walk's own deliberately-cut network request (the not-counted test).**

## The reaction-honesty arc (P11) — the session's gate, passed live

At 85701, on the ballot's candidate reaction controls (the same
`ReactionControl` every surface uses):

1. **First-ever tap parks behind the one-time notice** — nothing records
   until "OK — record my answer" (P03 unchanged).
2. **With the network cut** (route aborted): the tap renders the honest
   line — "Couldn't reach the totals — your answer is saved on this
   device and wasn't counted." — with the device-local record still
   written. `walk0814b-85701-reaction-notcounted.png`.
3. **With the network back**, changing the answer lands a 204 and EARNS
   the selected-and-counted rendering; the honest line leaves.
   `walk0814b-85701-reaction-counted.png`. This tap wrote a real row
   (dev holds the production DATABASE_URL): CANDIDATE / Katie Hobbs /
   UNSURE at 2026-08-14T20:18:10Z — the session's own, excluded from the
   tester delta.

**The deployed-site tap (the item-1 gate):** production's platform
password is DOWN (found this session — the site loads openly), so the
probe ran against the real deploy: one tap on Katie Hobbs's card at
2026-08-14T20:20:21Z landed as a visible Neon row at 20:20:23Z
(`CANDIDATE ballot-az-pima:governor|Katie Hobbs YES ANONYMOUS`),
control-screenshot `walk0814b-production-tap.png`, row pulled by direct
SQL and recorded in state.md §18. Tap → row: the pipeline proves itself
end-to-end on the deployed site.

## The everyday ask box (A10)

- **The pothole golden at 85701**: "There's a pothole in front of my
  house — who do I call?" → the hang-tight beat ("I got you... hang
  tight..." — never a thinking label), then City of Tucson Street
  Maintenance answered through **Tucson 311** with the request portal
  link and the city's own page cited. `walk0814b-85701-ask-pothole.png`.
  The city's current page says 311 — the old direct TDOT number that
  still circulates in 2015-era news stories is deliberately not shipped.
- **07866 answers with BOTH municipalities** — Rockaway Township DPW &
  Utilities and Borough of Rockaway DPW, each named plainly (the zip
  crosses the boundary; the reader knows which town they live in, the
  map cannot). `walk0814b-07866-ask-pothole.png`.
- **03255**: Newbury Highway Department, 603-938-5494, off the town's
  own page (read in a real browser — the host walls plain clients).
  `walk0814b-03255-ask-pothole.png`.
- **The refusal stays honest** at every zip ("Rather than guess…"),
  `walk0814b-<zip>-ask-refusal.png`.
- **The refusal log drove the map**: "my kids school" — a live refusal
  logged at 18:49 UTC today — now routes to How a school is being run;
  "I want a bike lane" routes to Streets and roads.

## The scrub disclosure (T09)

The transparency page states the blanking of phone-, email-, and
street-address-shaped text before storage, at every zip walked.
`walk0814b-<zip>-transparency.png`.

## Walk logs, verbatim

```
== walk0814b 85701 ==
PASS map: who-governs renders
PASS ask box present
PASS A10: the hang-tight beat renders, the author's words
PASS A10: the beat never says Thinking
PASS A10 golden: pothole → Tucson Street Maintenance via 311
PASS A10: the 311 phone renders
PASS A10: the source is cited on the card
PASS A10: the honest refusal still renders
PASS A10: 'my kids school' (this morning's live refusal) now routes
PASS P03: the one-time notice gates the first tap
PASS P11: a failed write renders the honest not-counted line
PASS P11: a landed write earns the counted rendering — the line is gone
PASS P11: the landed answer renders selected
PASS T09: the scrub is disclosed
PASS ask box disclosure still present
console errors: the walk's own aborted /api/reactions request only

== walk0814b 07866 ==
PASS map: who-governs renders
PASS ask box present
PASS A10: the hang-tight beat renders, the author's words
PASS A10: the beat never says Thinking
PASS A10: BOTH municipalities answer at 07866
PASS A10: the honest refusal still renders
PASS T09: the scrub is disclosed
PASS ask box disclosure still present
console errors: none

== walk0814b 03255 ==
PASS map: who-governs renders
PASS ask box present
PASS A10: the hang-tight beat renders, the author's words
PASS A10: the beat never says Thinking
PASS A10: Newbury Highway Department answers the pothole
PASS A10: the honest refusal still renders
PASS T09: the scrub is disclosed
PASS ask box disclosure still present
console errors: none

== walk0814b 85641 ==
PASS map: who-governs renders
PASS ask box present
PASS A10: the hang-tight beat renders, the author's words
PASS A10: the beat never says Thinking
PASS A10: the honest refusal still renders
PASS T09: the scrub is disclosed
PASS ask box disclosure still present
console errors: none
```

## Honest findings, not walked around

- **The incumbent record link would not open its modal under this
  harness** — hydration confirmed live (React props attached, sibling
  controls responsive), three click strategies, zero DOM change. The
  0819 pass exercised the same link green, and nothing in this session
  touched that path; this reads as a harness quirk, but it is UNPROVEN
  this session, so it goes to the author's thirty-second hand check in
  "Before you send the link" rather than into a green claim.
- The map's who-governs official popups could not be driven by the
  harness's click dispatch this session either (same shape); official
  cards were exercised through the ballot path instead.
