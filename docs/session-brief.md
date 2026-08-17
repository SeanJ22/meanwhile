# Session brief — g10 (written 2026-08-17 by g9)

The queue, exactly where g9 stopped. Resolution, no drift.
On completion, overwrite this file.

This session runs unattended. Nobody is available to answer.

**NOTHING IN THIS BRIEF IS CUTTABLE.** Work items in order, complete each
whole, keep starting the next until the session genuinely ends, defer whole
with a row, and report completion against the denominator. Where a disposition
in `docs/deferred.csv` and this brief disagree, the disposition governs. Read
each row's full Notes in `docs/tracker.csv` before building; the specs live
there and this brief does not restate what a row already holds.

**THE AUTHOR'S STANDING RULE:** a screenshot or named instance is an EXAMPLE of
a class-wide defect. Fix the class at the shared code path, audit everywhere
the pattern occurs, report the full count found and fixed.

---

## 0 — Two things that need the author's hands, stated first because they block measurement

Neither is buildable by an agent. Both are one-line edits in `.env.local` and
both are the same mistake, so they are fixed together.

**R36 and R42 are one swapped line.** The readonly role the author created by
SQL on the production branch had its connection string written over
`DATABASE_URL` — the LOCAL branch line, host `ep-weathered-cherry`,
`WTP_DB_ROLE=local` — instead of over `WTP_PRODUCTION_DATABASE_URL_READONLY`,
which still carries `neondb_owner` on `ep-dry-river`. Verified by
`pnpm verify:readonly` on 2026-08-17: `current_user = neondb_owner`,
`pg_has_role(neon_superuser) = true`, INSERT/UPDATE/DELETE all granted on all
three stores, and `delete from search_log where false` **permitted**.

- **R36:** put a readonly string pointed at the PRODUCTION endpoint
  (`ep-dry-river-axwtolzc-pooler`) into `WTP_PRODUCTION_DATABASE_URL_READONLY`.
  Then `pnpm verify:readonly` — it exits non-zero printing "R36 STAYS OPEN"
  until every check passes and exits 0 printing "R36 CLOSES" when they do.
- **R42:** point `DATABASE_URL` back at a role that EXISTS on the local branch.
  Today it cannot authenticate at all, so every local write path fails at the
  driver and no local run can prove a write succeeds. The fastest check is
  submitting the form at `/feedback` locally: a 204 means fixed, a 500 means
  not.
- If a writing handle to production is still wanted for migrations and backmark
  passes, carry it under a name that says so — `WTP_PRODUCTION_DATABASE_URL_WRITE`.
  g9 had to use the variable named READONLY to apply migration 0005, which is
  R36's complaint demonstrated.

**Do not create or alter roles yourself, and do not force it.** If the author
has not done this by the time you run, say so and carry on; every other item
below is reachable without it.

**One decision is waiting on the author and blocks nothing: R41.** Should the
feedback form collect an OPTIONAL reply address? R40's spec said both
"identifier-free beyond what the reader types" and "T09 scrub before storage",
and both cannot hold for one field. g9 took the strict reading and the form
says out loud that we cannot write back. If the author rules yes, the shape is
already specced in the row and is purely additive.

---

## 1 — The six remainders of g8's item 4, same order, specs in each row

They do not change. In order:

* **D19** — sitting-as persistence and the live ingest path. An unresolved
  heading still attributes to NOTHING, never to the host.
* **D18** — virtual meetings render as "online" with join info, in the list
  overlay, never a fabricated pin. The class is EVERY adapter's virtual events,
  not just Legistar's two.
* **D24** — the 348 unmatched canonical OCD divisions: close where a match
  exists, record per-division why none exists where it does not. Never a fuzzy
  join.
* **D31** — the curated-ID convention settled per the row: check opencivicdata's
  own convention first, adopt or mint under the documented `curated:` scheme,
  fix the two named consequences.
* **M12** — the school overlay split into unified / elementary / secondary:
  three types, three sources, three toggles, tests updated.
* **D22** — the NovusAgenda adapter against a LIVE tenant only; the Vail tenant
  is an archive. If no live tenant exists in scope, that finding is the
  deliverable and the row records it.

M19 is DONE (g9) and leaves this list.

## 2 — Resume the g7 item 4–8 block, whole, in order

The full specs are in the g7 brief and its referenced rows, unchanged:

* **item 4** — the ask surface: one build closing A01, A02, A07-same-PR, M119,
  A06, G05-4d; copy promises only what routes.
* **item 5** — G05: rules 4a–4c, 4e, 4f, 4h.
* **item 6** — G07: the pill label.
* **item 7** — D35: positions three-answer machinery.
* **item 8** — the fourteen finish-now rows: M134, M136, M139, M135, M07, B15,
  G10/8a, P01, P03 with free-text gated on T05, D25, D29, D06 under the
  unchanged structural FEC rule, M93 proposal-only.

## 3 — H02, whose surface now exists

H02's missing-body feedback link is the surface R40 shipped, with a second
entry point. The `feedback` store's `surface` column already holds `COVERAGE`
for exactly this, so the link needs no new page and no new store — wire it,
pass `surface="COVERAGE"`, and the author's queue tells the two apart.

---

## Handoff

`pnpm walk:all` against production, new checks appended, old and new counts
stated, the identity set emitted — it must stay 100% distinct, and a duplicate
is now a NAMED REGRESSION that fails the run rather than a printed suggestion.
`state.md` via `pnpm stamp`. Tracker rows by ID; `docs/deferred.csv` NOT
regenerated. Update `docs/session-map.md` with this session's closures — it is
in the repo and the mirror, and keeping it current is part of every handoff.
Playbook diff or explicit "nothing new". Overwrite `docs/session-brief.md`.
`pnpm handoff --ship` with the R22 gate; verify the deploy LANDS via
`/api/build` and state the SHA.

Standing report in the established format: ship status; test, lint, build
counts with allowlisted warnings named; every mirror file by name with bytes;
`context.md` against its 40 KB cap; tracker rows touched by ID;
`stamp-audit.md` inline; production rows by run-id census — expected 0 organic
throughout. Completion against the denominator, and within each item, sub-items
completed of sub-items listed. Ending with "Needs your hands."

## Standing rules

All of `CLAUDE.md`'s non-negotiables. Diagnose before fixing. No empty success.
Never assert absence. Stated N equals rendered rows. Denominators always
stated. A screenshot is an example of a class, never the instance. Screenshot
before believing green; where a measurement can pass while wrong, measure the
right thing. Every reader-facing date is wall clock via `pnpm stamp`. A render
default may never manufacture a claim.

**Correct first. Fast second. Nothing third.**
