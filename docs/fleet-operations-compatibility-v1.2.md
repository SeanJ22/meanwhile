# Fleet compatibility delta v1.2

This local follow-up starts at `9bd72b26`; earlier commits and evidence are
preserved. Claude retains UI ownership. The receipt integration below is
implemented now and is available to isolated producer/Admin checks. It does not
depend on PDC finishing its transition. Operational use and served proof still
require the later authorized handoff; PDC's denominator does not expand.

## Additive producer contract

The existing `fleet-operations/v1` envelope, `fleet-operations/extensions/1`,
`fleet-delivery/v1`, HTTP statuses, owner/session guard and no-store behavior
remain. Strict validators and fixtures must accept these additions:

| Addition | Meaning and provenance |
| --- | --- |
| `FleetOperationsReport.receiptLoading` | Existing ReadOutcome envelope containing metadata from `fleet-receipt-loading/v1`. Full private filesystem receipts are not exposed in this field. |
| `receiptLoading.value.entries[]` | Canonical window/receipt identity, target kind, load state, observation time, last successful read time and exact gaps. LOADED means a valid file was read and bound to its summary; it does not mean promotion or verification passed. |
| `receiptLoading.value.limits`, `.truncated` | Enforced file-count/byte limits and omitted references. Truncation is an evidence gap, never a complete receipt history. |
| `publication.delivery.value.items[].receiptLoads` | Relevant load entries: exact receipt IDs where held, or unresolved batch references from the item's windows when per-item identity is unavailable. Batch scope is not promoted into per-item proof. |
| Existing `items[].receipts`, `.gaps`, `.status` | Receipts now arrive through the loader. Retained historical receipts remain inspectable but non-LOADED or truncated loading blocks successful local verification classification. Failed/reversed receipts keep their existing failure/reversal evidence. |

`publication.status` stays **UNKNOWN** without actual served-reader proof.
Loading a successful receipt does not supply a current local snapshot readback,
much less served proof. Existing explicit internal readbacks still work, and an
old readback cannot make a failed receipt refresh look verified.

## Trusted loading and retention

`fleet-receipt-store.ts::createFleetReceiptStore({ targets })` accepts roots
chosen by server code. It reads only canonical window-summary receipt IDs from
the existing `promotion/promoter.ts::RECEIPTS_DIR`, with bounded file count and
bytes. Requests and stored summary paths never choose a filesystem root.
Schema, receipt ID, target, window and summary bindings are checked before a
receipt reaches the projector; invalid, missing and unavailable reads stay named.
Defaults are 64 receipt files, 1 MiB per file and at most 65 status entries
(including one limit marker). LOADED, MISSING, INVALID, UNAVAILABLE, RETAINED
and LIMIT_REACHED are distinct. The truncated count names skipped references,
not an invented count of unique missing receipts. Rejected paths are never read.

The promoter's existing files provide durable retention. A bounded process-local
cache retains the latest validated receipt when a refresh fails, with the
original successful observation time and a RETAINED state. It is a read cache,
not a second task/receipt ledger or a freshness clock. New valid failed/reversed
receipts supersede old successes. Restart loses only this cache; it does not
delete or rewrite the producer's retained files. No retention cleanup policy or
proof producer was changed.

`readFleetOperations(repos, { observedAt, receiptStore })` reads window history
once, then loads receipts once. A supplied store owns receipt availability;
caller-supplied old receipts cannot conceal its failed refresh. Without a store,
the earlier explicit internal-evidence API remains available and loading is
NOT_RECORDED. Store exceptions are redacted STORE_UNREACHABLE outcomes while
independent activity remains held. Partial, retained or truncated loading makes
response delivery freshness UNKNOWN using the existing read-freshness semantics.

The real GET route supplies a long-lived store for its own READER root,
`process.cwd()`. It grants no access to a runner's SHADOW directory. Missing
files or foreign target roots therefore remain explicit gaps. Deploy-time file
availability/mounting is an operational integration prerequisite, not a pending
loader implementation. No credentials, environment configuration, runner or
deployment were changed here.

## Isolated compatibility is executable now

`fleet-operations-http.ts::handleFleetOperationsRequest` is the real guarded
handler used by GET. Tests inject only its server-owned repository opener,
receipt store and observation clock. They exercise the actual producer, retained
files, loader, query service, authentication and serialized HTTP response with
isolated memory repositories and temporary roots. No browser or production
connection is needed for these backend contract checks. Claude can run them on
its local integrated branch now; UI rendering remains Claude's work.

```text
node --test --test-concurrency=1 --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/fleet-receipt-store.test.ts tests/fleet-receipt-admin.test.ts tests/fleet-operations-route.test.ts
```

Esbuild-based fixture controls require the same approved shell execution context
as the preceding isolated journey. They do not require live dispatch or network.

Only current production registration/admission, artifact availability on the
authorized Admin host, actual scheduled recovery, current permission/freshness,
and authority-bound served-reader proof wait for the operational handoff. The
previous checklist's isolated producer/Admin item is implemented and runnable
now; it is not deferred to PDC.

## ZIP gap delta

The new pure `zip-gap-resolution.ts::resolveZipPlanGaps` rechecks only the 23
named reference gaps and five separate coverage assignments. Its
`fleet/zip-gap-resolution@1` [actual output](evidence/fleet-zip-gap-resolution.example.json)
adds exact identities, existing obligation IDs, validated historical task links,
held evidence selectors and separate `runtimeReads` for each remaining dependency.
No earlier planning contract or example changed.

Held canonical evidence classifies eight statistical polygons, preserves one
duplicate-layer counterpart obligation, and links AZ/NH state sources to three
additional existing campaign-finance obligations and three historical task links.
Seven known bodies, NJ's known state portfolio, four source refreshes and all
five coverage-task mappings remain unassigned by the supplied evidence. Their
identity is not discarded merely because acquisition work is unheld. The
[recheck report](evidence/fleet-zip-gap-resolution.md) names the exact remaining
repository, occurrence, activity and state-readiness selectors. Held source
reuse and historical task identity still do not establish current execution or
the full applicable universe.

```text
node --test --test-concurrency=1 --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/zip-gap-resolution.test.ts tests/zip-acquisition-plan.test.ts tests/zip-queue.test.ts tests/new-zip-readiness.test.ts
```
