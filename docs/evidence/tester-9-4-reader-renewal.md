# September 4 dependency-aware reader renewal

The session uses the existing `reader-last-mile-finalize.mts --prepare` and
`--revalidate-source` machinery. It preserves the closed census, all original
row execution heads, canonical identity/eligibility projections and unaffected
retrieval evidence. It does not restart the historical Last-Mile campaign.

The inherited receipt binds 1,052 rows, including 373 RENDERED rows, 48,537
records and 1,303 holdings. Current re-attestation counts come from the execution
and finalizer output, rather than rewriting historical invalidation counts.

## Scoped current execution

`reader-last-mile-source-proof.mts` accepts `READER_RENEWAL_SESSION=V94` and
dispatches to `scripts/lib/reader-v94-source-proof.ts`. The existing historical
executor remains available unchanged. V94 requires:

- `READER_FINAL_PREPARED_CENSUS`: the integration owner's one prepared census.
- `READER_RENEWAL_EXECUTION`: a stable repository evidence output path.
- `READER_RENEWAL_VISUAL`: current browser observations with `exactHead`, the
  complete current `sourceHashes`, nonempty `results`, and empty `failures`.
  An optional `buildId` must match `.next/BUILD_ID`.
- Optional `READER_RENEWAL_EXPECTED_HEAD`, which must equal committed HEAD.

The executor reuses the actual existing district renderer for one canonical
division per affected district class/state; rerenders previously proved native
record classes and all held measure summaries through the current Ask renderer;
executes fresh grounded POST requests for named-body confirmation, held school
and county agendas, a ballot explanation and a person question; renders those
responses through the current components; and checks all three popup tiers with
and without their minimize affordance. Model/database credentials are removed
and fresh Ask execution rejects every network fetch. It inherits unrelated
ballot DOM proof without a ballot walk.

The source proof binds all inputs by hash and checks its complete dependency
graph before and after execution. Content-only SSR loads CSS module class names
without pretending to observe paint. Actual style, motion, themes and map
geometry belong to the separately hash-bound current browser observations.

## Removed dependencies are explicitly proved

The old validator required a current source hash even for a dependency removed
from the current import graph. That cannot describe the removal of the former
DOM state overlay and its raster-capability dependency.

`sourceRenewalDependencyProblems` now requires an explicit
`removedSourceHashes` entry, automatically derived from the prior committed
receipt. Each removed dependency must be in the actual changed set, match its
prior committed hash, be absent from the complete current dependency graph, be
absent from executed current sources, and be absent from current rendered-case
component claims. Duplicate and invented removals fail. Live dependencies still
require their current executed hashes. All committed baseline/ancestry, input,
case markup, canonical row, holdings and complete-graph checks remain in force.

The targeted validator suite passes three tests, with rejection cases for
missing/wrong removal hashes, still-current or still-executed dependencies,
rendered removed components, duplicates, invented/unchanged paths, absent prior
source and stale current execution. Exact removal with current execution passes.

## Integration-owner sequence

After the single production build and current visual observations, use isolated
scratch paths for `READER_FINAL_PREPARED_CENSUS` and `READER_PROOF_SOURCES`:

```text
node --experimental-strip-types scripts/reader-last-mile-finalize.mts --prepare
node --import tsx scripts/reader-last-mile-source-proof.mts
node --experimental-strip-types scripts/reader-last-mile-finalize.mts --revalidate-source
node --import tsx --test tests/reader-last-mile-census.test.ts tests/reader-source-renewal.test.ts
```

For `--revalidate-source`, also set `READER_RENEWAL_BASELINE` to the committed prior
receipt head, `READER_RENEWAL_PREFIX` to the new evidence prefix, and retain the
same execution/prepared paths. The finalizer itself verifies the prior receipt
against Git, recomputes changed dependencies, compares every canonical row,
validates current execution, and only then writes the canonical receipt.

The integration owner completed one prepare/census and one production build.
The renewal inherits all 1,052 canonical rows (373 RENDERED and 679 non-reader
rows), with unchanged census hash
`00561f84e6db6ef6d5aa75b6744b3d7e75127378f64f63f2235d548b623ffa6f`.
It invalidates 32 reader dependencies, including two removed imports, and
recomputes 187 presentation cases: 71 district, 90 previously held record,
20 fresh Ask rendering and six popup cases. Thirteen fresh deterministic Ask
requests and 18 current production browser/performance observations are bound
to the execution. The seven final production screenshots were reviewed.

The mandatory complete receipt test caught a successive-renewal classification
handoff: a later renewal must retain unaffected sources proved by its committed
predecessor. Inheritance now requires the same source hash in the prior receipt,
prior report and current graph, plus the byte-identical classification entry;
a failed/unclassified prior report, missing source, changed bytes or rewritten
acceptance/reason cannot inherit. The finalizer now runs the complete inheritance
validator before publishing, in addition to its existing source execution checks.
This preserves prior proof without re-executing unaffected reader surfaces.

`walk:all`, acquisition, autonomous/product-model workers and production
control-plane operations remain zero. No hash was hand-edited.
