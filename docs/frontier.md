# Frontier

Updated: 2026-08-30 (rev 4 — post-preflight). Priorities only — never
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
