# Trusted fleet receipt loading and historical retention

This follow-up adds `lib/control-plane/fleet-receipt-store.ts` and focused tests. Earlier recovery and delivery evidence remains unchanged. No promoter, proof contract, policy, migration, runner, credentials or production data was modified.

## Implemented boundary

`createFleetReceiptStore({ targets, maximumReceipts?, maxReceiptBytes? })` accepts explicitly configured absolute target roots. One root per target kind is allowed; ambiguous same-kind configurations are refused. HTTP input and recorded summary paths never select the root. The intended Admin default is its configured READER checkout; test SHADOW roots are passed explicitly.

The returned `FleetReceiptStore.read(windows, observedAt)` reads canonical window receipt references. It constructs each filename from `RECEIPTS_DIR` and an exact `pr-` plus 24 hexadecimal-character receipt ID. It does not scan directories or follow the summary's path. It checks every path component for symlinks/junctions, requires a regular file, verifies real paths, reads bounded bytes and compares file-handle identity with the final pathname to detect replacement during the read.

Loaded JSON must match the existing `PromotionReceipt` schema, receipt ID, target/root, window ID, canonical receipt/snapshot/before-copy paths, receipt timestamp and the window's count/refusal/reversal/incident summary. The summary path, when present, is compared only after deriving the allowed filename. Malformed, mismatched, oversize, unsupported-target and missing reads return named evidence gaps.

These checks validate receipt provenance and shape. They do not re-run publication authority, source evidence, reader projection or deployed-site verification. Failed, refused and reversed receipts are deliberately loaded so reporting can show the failure. Snapshot contents and source facts are not read by this store.

## Bounded contract

The return type is `FleetReceiptLoadReport`:

```text
version: "fleet-receipt-loading/v1"
receipts: readonly PromotionReceipt[]
entries: [{ receiptId, target, windowId, state, observedAt,
            lastSuccessfulReadAt, gaps }]
limits: { maximumReceipts, maxReceiptBytes }
truncated: number
```

Defaults are 64 receipts and 1,048,576 bytes per receipt. Each read returns at most `maximumReceipts` full receipts and at most `maximumReceipts + 1` entries; the additional entry is a `LIMIT_REACHED` sentinel. The candidate map and historical cache are bounded to the same order of size. `truncated` counts skipped summary references, including the sentinel reference; repeated references outside the retained candidate set can therefore each contribute. Callers must expose truncation and withhold complete/verified claims when relevant evidence was not read.

Entry states are:

| State | Meaning |
| --- | --- |
| `LOADED` | Full current file passed all loader checks; still not served-reader proof. |
| `MISSING` | No matching file exists and this store instance has no retained validated receipt. |
| `INVALID` | Named schema, binding, byte-limit, path or consistency failure without retained history. |
| `UNAVAILABLE` | Target is unconfigured or the file cannot be read. |
| `RETAINED` | Last validated historical content is returned alongside the new failure cause and `RETAINED_HISTORICAL_RECEIPT_NOT_CURRENT_PROOF`. |
| `LIMIT_REACHED` | This reference was not read because the count bound was reached. |

Any state other than `LOADED` must prevent the associated receipt from conferring current verified-delivery status. `lastSuccessfulReadAt` remains the actual prior caller-supplied observation time on failure. A newly validated failed or reversed receipt replaces earlier cached content; historical success is never selected just because it looks better.

An older completing request cannot overwrite cache content validated for a newer observation. Equal observation timestamps use an internal invocation sequence to prevent an earlier overlapping invocation overwriting a later one. That sequence is neither persisted nor exposed as a freshness clock. Durable receipt files remain the source of record; the bounded in-memory cache supplies process-local historical continuity only. A process restart or cache eviction cannot recover a missing receipt from this cache, and reports `MISSING` honestly.

## Verification

Actual command:

```powershell
node --experimental-strip-types --import ./scripts/register-test-loader.mjs --test --test-concurrency=1 --test-reporter=tap tests/fleet-receipt-store.test.ts
```

Result: **5 passed, 0 failed, 0 skipped**, **1079.3602 ms**. Actual output is [fleet-receipt-store.tap](fleet-receipt-store.tap). ESLint for both new TypeScript files and `git diff --check` passed. No benchmark gain is claimed.

The tests create actual promoter refusal files in isolated temporary roots. They cover initial load; missing-file historical retention and unchanged last-success time; missing after process-local cache loss; malformed JSON; invalid nested schema; mismatched target/window/summary/path; future timestamp; oversized bytes; invalid/traversal receipt IDs; unconfigured and ambiguous roots; a real Windows directory-junction refusal; contradictory summaries; output/file/cache count limits; cache eviction; and an older observation attempting to replace newer failed/reversed historical data. The failed/reversed lifecycle unit inputs are labeled shape-only negative controls, not claims of an executed civic promotion. The separate real-promoter Admin integration suite verifies actual successful and failed/reversed producer receipts through the reporting service.

Atomic-replacement and equal-timestamp in-flight ordering safeguards were added by code review; this unit suite does not claim to deterministically reproduce those filesystem scheduling races. Temporary recursive cleanup resolves and checks each generated root's parent and prefix. No other workspace or process is touched.

## Integration ownership

| Dependency | Required use | Owner / state |
| --- | --- | --- |
| `fleet-operations.ts::readFleetOperations` | Read the configured store once; expose loading entries separately from full receipt contents; non-LOADED or truncated evidence must not imply current verified output | Fleet; implemented and isolated checks pass |
| Authenticated fleet GET | Run owner authorization before store reads; construct trusted default READER-root store from application configuration | Fleet; implemented and isolated checks pass |
| `fleet-delivery.ts::projectFleetDelivery` | Join full receipts by canonical item/fact identity; retain SHADOW/READER and local/served distinction; preserve loading gaps | Fleet; implemented and isolated checks pass |
| `tests/fleet-receipt-admin.test.ts` | Real promoter files → bounded store → operational service → authenticated handler, including failed/reversed/retained evidence | Implemented and runnable now for Claude's local integration |
| Production receipt availability and configured-root permissions | Verify current files and referenced windows on the integrated authorized runtime | Fleet/backend integration owner after transition; no live verification performed here |

The new loader closes the previously missing trusted full-receipt loading path. It does not activate publication, change permission or spending policy, infer served output from batch counts, or expand PDC's proof denominator.
