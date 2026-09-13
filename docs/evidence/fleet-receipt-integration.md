# Local receipt integration

Continuation base: `9bd72b264a54e24c5eb58ec6dcb2e5a4cc7f3f8a` in the existing
independent `SeanJ22/meanwhile` clone and `fleet/isolated-progression-20260913`
branch. Prior commits, handoff files and recorded evidence are preserved.

The remaining local receipt adapter is now implemented and connected to
`readFleetOperations` and the actual authenticated Admin GET handler. It reads
the existing promoter's retained receipt files by canonical window-summary ID
under explicitly configured server roots. No new ledger, receipt/proof schema,
freshness clock, publication policy or producer was introduced.

The new [loader controls](fleet-receipt-store.md) verify bounded reads and
retention. The actual producer-to-Admin control creates the same 36 approved
Pima facts in isolation, writes real shadow receipts, and exercises the existing
source-bound local readback plus the real guarded HTTP consumer. Its recorded
windows are explicitly reporting fixtures, not executed scheduler windows.

The positive HTTP response contains exact loaded receipt/materialization and
post-write verification details but keeps local status UNKNOWN without a
readback. Supplying the genuine source-bound readback to the internal service
produces SHADOW_READBACK_VERIFIED while served publication remains UNKNOWN.
Missing or mismatched files then retain the last validated receipt visibly as
historical evidence and prevent that same old proof from remaining verified.

Additional controls produce actual failed verification and governed reversal by
corrupting only the temporary snapshot before invoking the existing verifier.
Those receipts remain visible as failures/reversals. The real gate-off refusal
remains HELD. Store errors preserve independent activity with redacted error
outcomes; truncated loads remain incomplete; public/unauthenticated requests
reject before any repository or receipt access. The committed snapshot is
unchanged and no live source, scheduler, production repository or deployment is
used.

The [actual combined TAP](fleet-receipt-integration.tap) records **31 passed,
0 failed, 0 skipped**, in **4,043.2682 ms** across the receipt-store,
producer/Admin, existing delivery, operations-service and HTTP guard controls.
This is a measured test run, not a performance-gain claim. Competing Claude/Node
processes were observed non-destructively before verification; controls used
serialized temporary fixtures, no server or port, and the approved exact offline
esbuild invocation. The existing runtime/recovery evidence is preserved.

The [Claude compatibility delta](../fleet-operations-compatibility-v1.2.md)
names the additive fields and runnable isolated checks. These checks are
available now on Claude's local integration branch, independently of PDC.
Only current operational reads/execution, authorized host artifact availability
and actual served-reader proof wait for the later handoff. PDC's completion
denominator remains unchanged.

The [bounded ZIP gap recheck](fleet-zip-gap-resolution.md) and
[named dependency output](fleet-zip-gap-resolution.example.json) distinguish
supported identity/method reuse from absent canonical assignment evidence.
Held-corpus reuse never establishes full source-universe coverage, and no ZIP
task or activation is created.

The [combined ZIP controls](fleet-zip-gap-resolution.tap) add **20 passed,
0 failed, 0 skipped**, in **3,506.1905 ms**, bringing this follow-up's focused
verification to **51 passing controls**. Full-repository TypeScript checking
(`tsc --noEmit --incremental false`) and ESLint across all nine changed/new
TypeScript files exited 0 after the code was frozen. Prior evidence files were
compared against `9bd72b26` and remained unchanged. No full build, shared CI,
production operation, push, merge or deployment was performed.
