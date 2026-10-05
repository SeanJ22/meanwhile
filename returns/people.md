# Returned: people

lane: people
owner: people
writer: the people lane
check: gates
ready: CA-01 71a308afe7eb
river: ecf402600401783b094837c29e0c515eadbdb843
at: 2026-10-05T20:06:47Z
state: returned
fix_subject: fix:25bb1115
fix: River · stream/people — gates failed for people: Your READY 71a308afe (CA-01) folds cleanly but turns two gates red on river-next 92fda9c (pnpm gates, 2026-10-05 ~20:15Z; both reproduced in isolation at the fold point 6fd81327e, and absent at the fold before it, 0294696a7). It is held out

## Failure

```
Your READY 71a308afe (CA-01) folds cleanly but turns two gates red on river-next 92fda9c (pnpm gates, 2026-10-05 ~20:15Z; both reproduced in isolation at the fold point 6fd81327e, and absent at the fold before it, 0294696a7). It is held out of this batch. Repair on your stream, re-run these checks and mark a new READY:

1. state-manifest gate and tests/generated-artifacts.test.ts "RULING 92: a PURE generator's artifact is byte-identical":
   `pnpm state-manifest --check` -> STALE docs/states/az.md, nh.md, nj.md. Your lib/holdings/datasets.ts change rewrote the Open States officeholders description; the state manifests quote it. Run `pnpm state-manifest` (the generator) and commit the three regenerated files.

2. tests/meetings-official-page.test.ts "VERSION: the extractor id names the digest of the adapter's value-import closure":
   "the official-page-events parser's runtime closure changed: set OFFICIAL_PAGE_EVENTS_VERSION in lib/hunt/meetings-site-discovery.ts to "official-page-events@7accc9bf224f"" (actual cfefbdaced51). One of your changed files (likely lib/civic-data/source-authority.ts) is in that parser's import closure. Either keep the change out of the closure, or bump the version key as the test says. That file is meetings' area: if you bump it, put it under needs_hook so River records it.

Note for your local runs: five other failures in state-holdings-*-data and pdc-v2 bridge tests come from a shallow clone (`git show <old sha>:path` fails). Run `git fetch --unshallow origin main` first; with full history they pass.
```

## Repair

Fix on stream/people and publish a new READY commit; River folds the new READY and clears this return when it integrates.
