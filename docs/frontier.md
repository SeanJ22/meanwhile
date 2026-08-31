# Frontier

Updated: 2026-08-31 (rev 5 — post Session B close). Priorities only — never
invariants (the generated constitution), never status claims (generated status
ledger). This is a mutable planning artifact, not law and not a governance
input.

## The three-question split

GitHub Actions answers: "Is this code safe to merge?" The ingestion runtime
answers: "Is the civic information fresh?" The production-integrity system
answers: "Is the deployed application healthy?" Never one notification stream.

## Sequence

1. Reconcile governance and contracts (Session A): rulings adopted under
   canonical IDs with explicit supersessions; Reader/Truth/Freshness contracts
   defined; ReaderQuestion, ControlFact, and VisualAcceptanceCheck schemas;
   scheduler persistence-provider decision recorded with migration/adapter
   plan (no migration executed); JOB16–18-class measurements rerouted from
   Needs-Owner to operational incidents.
2. Make the loop observable (Session A): suite scaffold running with honest
   zero-state and recorded render target; control-set plumbing with
   harness-only blindness proven at the context-assembly boundary; generated
   status ledger distinguishing SESSION_MEASURED from INDEPENDENTLY_REPRODUCED;
   generated repo inventory joined to the mirror via scripts/mirror-set.mjs.
3. Make freshness autonomous in shadow (Session B): authoritative due-work
   scheduling off GitHub cron onto the decided provider; derived next-due;
   freshness debt; deterministic routes running without commits or deploys.
   Cron-delay evidence (186–313 min typical, ~699 worst) is the standing
   justification. FRESHNESS reports NOT_READY until this is independently
   proved.
4. Connect scheduler to disposable workers (Session B/C): reuse the existing
   WorkItem/RouteTask/Attempt/lease/reclaim substrate — the lower half is
   built and exercised; only the dispatch upper half is new.
5. Overnight proof: repeated unattended cycles including at least one genuine
   route failure absorbed by retry/reclaim, each producing a correct digest
   whose headline is PILOT HEALTH (Reader + Truth + Freshness), activity
   counts beneath.
6. Activation gate: Reader green and stable on PRODUCTION_RENDER, Truth
   trustworthy on both false absence and false presence, Freshness within
   tolerance — all INDEPENDENTLY_REPRODUCED, never session-measured.
7. Level 2: verified low-risk civic-data promotion without sessions, branches,
   or deploys.

## Explicitly deferred

External orchestration (revisit trigger per the adopted ruling). New
multi-project investment. Level 4 auto-publishing past 2026-11-03. <!-- expected-future: the author's Level-4 automatic-publishing deferral horizon, deliberately past the 2026 general election -->
Level 5 removed. National activation (pilot health green and stable, plus
cost-model national math from measured pilot numbers).

## Carried forward from Session B (2026-08-31)

Priorities, not status. What the closing sweep left standing, and what each is
waiting on.

### Waiting on the owner, and published where he reads them

Six rows, `needs-sean` section, `OWN01`–`OWN06` — each carries what is needed,
why the machine cannot proceed, what was tried, and what continues without it.
Four are one decision each; two are one approval each.

- **`OWN03` / OFF-9 is the cheapest of them.** The acquisition already ran: 9
  statewide portraits are queued off the offices' own pages, decoded and
  name-matched, Mayes at 442×553. RULING 55 reserves the review to the author,
  so approving them is the entire remaining step.
- **`OWN02` / OFF-8** names 5 Tucson portraits whose 480×720 originals are
  publicly available, and 138 where the government publishes nothing larger —
  the second half is a source decision (a different door for a sitting
  official), not a render one.
- **`OWN05` / BAL-36** and **`OWN06` / BAL-37** are both ask-before source
  additions: state executive-action records, and an address typeahead with its
  own privacy question about partial addresses leaving the product.

### The check debt, which is the biggest thing this session found and did not fix

Thirteen rows of the 8.30.26 sweep were recorded FIXED against `vac:` check ids
naming a VisualAcceptanceCheck store that **does not exist** —
`data/health/visual-checks.json` is not on disk and the suite's last run
recorded `checksLoaded: 0`. They are enumerated on the sweep's `checkDebt`,
printed on every `feedback:sweep` run, and **not counted verified fixed**.

Closing them needs two things this session deliberately did not start, because
each is a workstream rather than a repair:

1. **`visual-suite.mts` has no evaluator for any DOM-certifiable property.**
   `text_content`, `element_presence`, `element_count`, `link_target` and
   `stated_n_equals_rendered_rows` all fall to the `default:` branch and return
   `NOT_EVALUABLE`. So a `vac:` check could not be graded even if one existed.
2. **The twelve checks themselves**, authored against the surfaces the rows are
   about. The probe data for most of them is already measured — the
   who-governs disclosure, the statewide slate, the ballot contact routes.

### A reader-facing gap the WGH-22 hunt turned up

**A street the Census carries only at the address level is refused by the
street-only form.** `South Bear Table Tank Drive` in 85641 — the owner's own
address — returns `FAILED / NOT_FOUND` from `/api/address/resolve` in every
street-only spelling, and resolves completely the moment a house number is
supplied. The prompt asks for a number only when a street is AMBIGUOUS, so that
branch never fires: the reader is told we could not place their street while
the resolver would have placed their house. Common on rural and named-feature
roads. Recorded here rather than fixed — it is not in the 8.30.26 sweep and it
falsifies none of this session's acceptance criteria (RULING 221).

### Still open from the sequence above

W6's overnight proof and the activation gate are untouched by this session and
stand exactly as written. The **model half of cost truth is now PROVEN** — see
`pnpm model:proof` — so item 4's dispatch upper half has one real
`BOUNDED_MODEL_WORKER` Attempt behind it with provider-reported usage and a
computed cost, rather than a lane label.
