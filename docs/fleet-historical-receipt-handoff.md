# Historical receipt extraction — section 3 backend delta

Base: `d685fc4afd48ce157d37d4e77987a120ffcbb263`, branch
`fleet/isolated-progression-20260913`, independent clone
`C:\Users\seanj\dev\meanwhile-fleet-engineering-20260913`, verified remote
`https://github.com/SeanJ22/meanwhile.git`. Prior commits and evidence remain
unchanged. The integration handoff was read as context; this change implements
only the user's assigned section 3 backend extraction.

`lib/control-plane/promotion/historical-receipt.ts` is the immutable
`promoter/1` archive contract: receipt/authority/target/refusal shapes, frozen
nested verification/incident/change shapes, constants, pure summary and schema
validation. It has **zero imports, including type imports**. Historical receipt
interpretation therefore does not depend on the executable producer, evolving
legacy window types or Reader projection implementation.

The loader imports that leaf; `fleet-delivery.ts` and `fleet-operations.ts` now
take their receipt type directly from it. `promotion/promoter.ts` imports and
re-exports the existing names for compatibility while this producer exists.
No producer behavior or publication gate changed. The extraction does not add
a writer, authority factory, window runner or publication path to the leaf.

**Integration disposition:** when PDC deletes `promotion/promoter.ts`, keep the
deletion. Drop this delta's compatibility edit to that deleted file; retain the
new leaf and direct historical-consumer imports. Never restore the producer to
satisfy a modify/delete conflict. No API mount, UI, Claude workspace or PDC file
was changed here. Claude owns remounting and page/Refresh parity.

Wire versions and receipt semantics remain unchanged. Mechanical comparison to
the base confirmed unchanged executable producer and authority-factory bodies,
summary logic, schema checks (apart from moved/exported helper names), and
loader path/identity checks, bounded reads, retention timestamps, cache order,
failure and reversal handling. Existing served-publication reporting remains
UNKNOWN without served proof.

## Focused evidence

The existing receipt-store and real producer/Admin controls report **14 passed,
0 failed, 0 skipped** in [the actual TAP](evidence/fleet-historical-receipt-extraction.tap).
Those tests use isolated resources and injected server dependencies. They are
not evidence that Claude's currently unmounted store is served.

The [baseline import metadata](fleet-receipt-imports-baseline.json) records the
exact fleet base and esbuild settings. The new import-boundary test records the
post-extraction executable closure and exercises a copied archive loader with
the producer and its data physically absent. These are focused import controls,
not Next.js build/trace certification or a rerun of the handoff's separate
Claude bundle measurements. No broad certification was run.

The measured closure is **44 → 3 inputs** with the same esbuild settings;
the leaf has zero imports. **Four import controls pass**, including a strict
standalone leaf typecheck, bringing focused verification to **18 passing
controls**. Targeted ESLint passed for the five changed runtime TypeScript
files and the import test. See [import evidence and limits](fleet-receipt-imports.md).

## Dependencies intentionally not resolved

1. **Removed window member:** the loader still accepts `WindowRunRecord[]` and
   derives `Summary` from `WindowRunRecord["promotionReceipts"]`; delivery also
   joins that member. PDC removes it. The runtime import extraction does not
   make those types compatible with final PDC. Integration still needs an
   authorized historical window/receipt selector or adapter, without restoring
   the member as a claim about permanent output. A type-erased archive-loader
   test is not proof that these final PDC type joins compile.
2. **Permanent receipt authority:** historical `promoter/1` files are not PDC's
   `ValidationReceipt.contractVersion: 2`, candidate/event/promotion records or
   `RoutineRunnerReceipt`. Final canonical selectors, source/class/scope and
   version/LKG bindings, retained-history location, and the supported Admin read
   path remain PDC-handoff/integration inputs. No conversion or current-delivery
   proof is invented here.
   Existing tests that generate legacy receipts use the producer only while it
   exists; their eventual retirement/fixture adaptation must not restore that
   producer. The producer-absent archive control remains independently runnable.
3. **Served integration:** Claude owns the initial page and Refresh mounts.
   The handoff reports both unmounted at `c333361…`; this delta does not change
   that. Host artifact availability, final combined bundle/page certification
   and actual served Reader proof remain separate integration work.

No production action, policy change, push, merge, deployment or activation was
performed. PDC's completion denominator is unchanged.
