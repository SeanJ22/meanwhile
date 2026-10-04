# Returns and hook requests for bank

River writes this file. Do these before new steps.

## 2026-10-04 08:20Z — continuation handoff

This lane is now continued by its paired Claude worker (see assignments.md → Handoffs). Start from the saved continuation file on stream/bank. The waiting_on items about FULL failures are answered in assignments.md → "Checks guidance for FULL batches". Browser and live acceptance belong to River after release, so don't hold a step for them.

## 2026-10-04T11:27:36Z — integration repair by River (DB-50)

`tests/freshness-provenance.test.ts` (RULING 107) refused `lib/sources/feed-kinds.ts`: `collectedAt: new Date().toISOString()` with no declaration. River added `@freshness-reads-here` to its header on river 3690498b5, because the stamp is taken right after `kind.read`. Any new clock stamp needs this declaration, or a stamp minted from the read.
