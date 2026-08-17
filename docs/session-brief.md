# Session brief — g9 (successor to g8, 2026-08-17)

The g8 session ended having landed the deploy and worked the top of the g7
queue. This brief is written for whoever picks it up. **Nothing here is
cuttable.** Work the items in order, complete each whole, keep starting the
next until the session genuinely ends, defer whatever remains whole and
specced, and report completion against the denominator.

Where a disposition in `docs/deferred.csv` and this brief disagree, **the
disposition governs**. Read each row's full Notes in `docs/tracker.csv` before
building; the specs live there, and g8's rows carry the evidence so you do not
have to gather it twice.

## Four things you would otherwise rediscover

1. **The deploy is landed and verifiable.** `/api/build` returns a real SHA
   now. `main` is at `e8f7b77` or later; the endpoint is the check, not the
   green build. `pnpm handoff --ship` polls it and refuses to claim a landing
   it did not see.
2. **`.env.local` points `DATABASE_URL` at a LOCAL Neon branch** (R34). Do not
   repoint it at production. A script that must read or write production reads
   `WTP_PRODUCTION_DATABASE_URL_READONLY` explicitly — and note R36: **that
   variable is not read-only.** Its role is `neondb_owner`.
3. **`docs/deferred.csv` is never regenerated.** The refusal guard stands and
   the author's Disposition column lives only there.
4. **The walk emits a check-identity SET** to `docs/walk-checks.txt` and diffs
   against the committed one. Do not compare totals by subtraction; read the
   `added` / `GONE` lines. Three checks currently share an identity with
   another — the run names them, and giving them distinguishing names is a
   small work item.

## The author's standing rule, law for every fix below

A screenshot or named instance is an **EXAMPLE of a class-wide defect**, never
the only occurrence. Fix the class at the shared code path, audit everywhere
the pattern occurs, and report the full count found and fixed.

---

## 1 — The author's production feedback of 2026-08-17 (P0, first)

g8 opened both rows with their full specs and deferred them WHOLE rather than
half-build them. They are the author's own words about the shipped product and
they go first.

**1a — R39: one "Phone" pill replaces stacked numbers, everywhere.** The
Shaheen card renders seven phone rows and is the EXAMPLE; the scope is every
official with more than one recorded number, at every zip, on every surface the
contact pills render, fixed at the shared component. One pill labelled "Phone".
Multiple numbers → a modal centred on screen, numbers listed vertically, each
labelled by its office **from the recorded data** (never inferred from an area
code — an inferred office label is a generated claim about a public official),
each a `tel:` link. Exactly one number → the pill is a direct `tel:` link, no
modal. The modal sits OVER the battlecard; dismissing it returns the card
untouched; one modal at a time; native dismissal per M90's pattern. Provenance
unchanged. If any official carries multiple emails, same treatment; if none,
state that and change nothing. Report the count of officials with more than one
number and that every one renders the single pill. Walk checks at Shaheen and
at a single-number official, both viewports, both themes.

**1b — R40: the personal email leaves the product; Feedback becomes an in-app
form.** The two halves are ONE SUBJECT — removing the address without shipping
the form leaves a reader with no way to reach anyone. Full spec on R40,
including the one boundary g8 found while scoping: `app/api/geocode/route.ts`
sends the address in an OUTBOUND User-Agent, which is a server-side contact
route the courteous-client rule requires, and is outside the row's scope.

## 2 — The g7 queue's eight remaining sub-items, in order

g8 closed five of the thirteen (R05, R23, G04, R37 the check identities, R38
the reader-facing source name) and shipped B01's interim rename. These eight
remain, each with its full spec on its own row:

**M19** (overlapping pins swallow each other's clicks) · **D19** (sitting-as
persistence and the live path) · **D18** (virtual meetings render as "online"
with join info, a list overlay, never a fabricated pin) · **D24** (the 348
unmatched OCD divisions) · **D31** (curated-ID convention settled) · **M12**
(the school overlay split into three) · **D22** (the NovusAgenda adapter —
**read the row's own correction first**: the Vail tenant is an archive, the
adapter is built against a LIVE tenant only, and if no live tenant exists in
scope, that finding is the deliverable).

M19 is the largest and it is first: it needs a real decision between spiderfy,
clustering and zoom-dependent grouping, and a walk check that can see a pin
intercepting another's clicks.

## 3 — g7 items 4 through 8, whole, in order

Never started, still deferred whole with their specs intact. In order:

* **item 4** — the ask surface: one build closing A01, A02, A07-same-PR, M119,
  A06, G05-4d; copy promises only what routes.
* **item 5** — G05: rules 4a–4c, 4e, 4f, 4h.
* **item 6** — G07: the pill label.
* **item 7** — D35: the positions three-answer machinery.
* **item 8** — the fourteen finish-now rows: M134, M136, M139, M135, M07, B15,
  G10/8a, P01, P03 with free-text gated on T05, D25, D29, D06 under the
  unchanged structural FEC rule, M93 proposal-only.

## 4 — Two small debts g8 created and named

* Three walk checks share an identity with another, so the identity diff counts
  them once. The run names them. Give them distinguishing names.
* `docs/mirror-code-ids.json` declares `session-map.md` **pending**: it has no
  Drive id until it has been copied to Drive and `pnpm mirror:ids` has run
  against the live folder. Run it and move the entry from `pendingDocs` into
  `docs`.

## Handoff

`pnpm walk:all` against production, new checks appended, old and new counts
stated, with the identity diff (`added` / `GONE`) quoted rather than summarised.
`state.md` via `pnpm stamp`. Tracker rows by ID; `docs/deferred.csv` NOT
regenerated. Playbook diff or an explicit "nothing new". Overwrite this file.
`pnpm handoff --ship` with the R22 gate, and verify the deploy LANDS via
`/api/build` — state the SHA it returns.

Standing report in the established format: ship status; test, lint, build
counts with allowlisted warnings named; every mirror file by name with bytes;
`context.md` against its 40 KB cap; tracker rows touched by ID;
`stamp-audit.md` inline; production rows by run-id census. Completion against
the denominator. Ending with "Needs your hands."

## Standing rules

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. No empty success.
Never assert absence. Stated N equals rendered rows. Denominators always
stated. A screenshot is an example of a class, never the instance. Screenshot
before believing green; where a measurement can pass while wrong, measure the
right thing. Every reader-facing date is wall clock via `pnpm stamp`. A render
default may never manufacture a claim.

**Correct first. Fast second. Nothing third.**
