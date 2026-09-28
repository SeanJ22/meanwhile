# Admin v6 instruction-history projection proposal

The existing `admin-action` receipt is authoritative for its gateway action, but it does not persist a versioned v6 action kind or a canonical place membership for arbitrary actions. Its `subject` can be an intent ID or a work-card ID. `decision.record` therefore cannot be joined to a place by matching `subject` to a scope key; `expansion.scope.set` cannot be labeled a new hunt without knowing whether it continued an existing instruction. The partial `admin-v6/history@1` adapter exposes only global runner pause/resume receipts. It must remain unannounced by live pulse and its `page.total` remains unknown.

## Additive durable contract, no live migration in this change

At a gateway action's successful append, store an immutable companion fact keyed by the original `ActionReceipt.receiptId`:

- `projectionVersion`, `gatewayReceiptId`, original `type`, `idempotencyKey`, and the original append position or immutable sequence.
- A versioned `v6ActionKind` derived from the command definition and validated input, or `null` with an explicit unmapped reason. In particular, classify scope-set as `hunt-start` only when the command itself establishes a new lifetime instruction; continuation and limit edits need their own distinct kinds.
- `scopeRefs`: exact canonical scope key **and instruction receipt ID** for each affected instruction. For globally acting commands use `us` with a global marker. Do not infer a ZCTA from a work-card label, state, subject text, or shared scope key alone.
- `targetRef` and plain display label from validated structured input. Never parse the gateway `says` prose to reconstruct identity.
- Immutable evidence references for later lifecycle steps: work/attempt/result, promotion/version/accepted record, and public reader witness, each bound to the same instruction receipt and exact subject/version. A queued action has null application/effect refs.

The companion is derived from the original receipt and validated command boundary. It does not replace or rewrite the receipt. A legacy backfill may populate only rows where original validated input and canonical instruction linkage are still durably available; all other legacy rows stay explicitly unclassified. Original and later hunts sharing a geography remain separate by immutable instruction receipt. A later action receipt must never replace the original lifetime budget's instruction receipt.

Index `(scopeKey, instructionReceiptId, appendPosition, gatewayReceiptId)` and expose keyset pagination with a revision/watermark. Full scoped count is available only after the projection has an audited completeness marker for the underlying receipt population; before then return `total:null` and named missing parts. Query/page limits remain bounded, and the Admin session/host guard stays required. The projection is an index of existing authority, not a new action or publication store. No table, trigger, migration, live backfill, or production write is included here.
