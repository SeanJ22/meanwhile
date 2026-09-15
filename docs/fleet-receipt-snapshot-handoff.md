# Admin receipt snapshot compatibility delta

Base: `e1140c784325a92e531e70ae3bb9683c11f07dcb`, branch
`fleet/isolated-progression-20260913`, independent clone
`C:/Users/seanj/dev/meanwhile-fleet-engineering-20260913`, canonical remote
`https://github.com/SeanJ22/meanwhile.git`. Prior evidence and historical leaf are unchanged.

The supplied Lumen Phase-5 handoff is integration evidence, not new permission to
change UI or PDC. Its reported mounted-fs build failure is distinct from the
earlier import-closure improvement. No tracing exclusions or budgets change here.

## Implemented read path

Runner-owned trusted archive store → bounded reporting cache on the existing
`OwnerSnapshot/current` aggregate → `readFleetOperations` → guarded Admin HTTP.
The web application reads the database; it does not mount `createFleetReceiptStore`.
The historical archive remains the authority. This cache is neither an independent
receipt ledger nor a new publication mechanism. Raw receipts stay server-side;
the public-to-Admin wire exposes the existing projected delivery and load status.

`withFleetReceiptSnapshot(snapshot, {store, readWindows, previous})` is the
runner-side composition function. It reads only the supplied resources and returns
a snapshot; it has no repository writer, schedule or environment discovery.
Pass `previous` from the **same existing owner-snapshot revision** used for the
normal publisher's CAS. Recompute this field during every full publication.
Do not add an independent partial writer: `scripts/publish-owner-snapshot.mts`
replaces the whole snapshot and would erase that writer's extension next cycle.
On a CAS conflict, follow the existing publisher's conflict behavior; never blind-put.

The production publisher/runner is not modified or activated in this delta.
Its final historical selector and authority remain pending. The composition and
repository-to-Admin path are independently executable in isolated tests now.

## Additive contract

Existing `fleet-operations/v1`, `fleet-operations/extensions/1`, `fleet-delivery/v1`
and `fleet-receipt-loading/v1` shapes stay unchanged. The optional injected store
seam is preserved for runner/test compatibility. With no injection, both page
seed reads and Refresh use the existing owner snapshot automatically.

New optional `OwnerSnapshot.fleetReceipts` (server-side transport):

```ts
{
  version: "fleet-receipt-snapshot/v1",
  authority: "HISTORICAL_PROMOTER_1",
  observedAt: string, // runner observation, equal to this publication's publishedAt
  loading: ReadOutcome<FleetReceiptLoadReport>
}
```

New additive `FleetOperationsReport.receiptSource` example (illustrative):

```json
{
  "kind": "OWNER_SNAPSHOT",
  "observedAt": "2026-09-05T18:01:00.000Z",
  "authority": "HISTORICAL_PROMOTER_1",
  "freshness": "STALE",
  "permanentAuthority": "NOT_CONNECTED"
}
```

`kind` is `INJECTED_STORE` only for explicitly supplied internal stores. No HTTP
parameter chooses a store, root, path, receipt or proof. Existing authentication,
public-host refusal, typed 503 responses and no-store headers remain in force.

Transport is limited to 1 MiB serialized UTF-8, in addition to the existing
store's file/count/cache limits. Version, nested historical receipt shape,
load-entry identities, duplicate/completeness constraints and timestamps are
validated again at the read boundary. This validates transport, not new proof.

- Absent extension: `NOT_RECORDED`, unknown freshness; no empty-success claim.
- Invalid, future-dated, oversized or unreadable extension: typed
  `STORE_UNREACHABLE`; independently readable activity remains available.
- Fresh complete load: original statuses and successful-read times are preserved.
- Stale load: the existing `PULSE_STALE_MS` threshold is reused. `LOADED` becomes
  `RETAINED` with `RECEIPT_SNAPSHOT_STALE`; original observation and successful-read
  timestamps do not advance because Admin queried again.
- Missing/invalid/unavailable file after publisher restart: matching prior
  snapshot receipt can be retained within the same bounds, with its old successful
  timestamp and current failure gaps. It cannot prove current materialization.
- Whole collection failure: bounded prior history is retained with
  `RECEIPT_COLLECTION_FAILED_HISTORY_ONLY`; without prior evidence it is unavailable.
- New valid failed/reversed evidence wins over old success. Retention never
  resurrects success. Outer served publication remains `UNKNOWN` in every case.

## Claude compatibility and ownership

Keep the optional-store form already on the integration branch. Both
`readFleetSeedState({open, now})` and `handleFleetOperationsRequest(req, {open, now})`
obtain the additive snapshot reading through the shared backend. **Do not remount
the filesystem store** in either served entry. This fleet delta's route edit only
removes the old default store; preserve Claude's equivalent wiring/comments at
integration. No page, component, styling or Refresh interaction is authored here.

## Exact remaining dependencies

1. Historical selection: `fleet-receipt-store.ts` still derives summaries from
   `WindowRunRecord.promotionReceipts`; `fleet-delivery.ts` also reads that member.
   PDC removes it. Integration needs an authorized retained-history selector
   returning historical window identity/time and the frozen summary references,
   plus its archive root. Do not restore the member or retired producer.
2. Permanent authority: historical `promoter/1` is not `ValidationReceipt` v2 or
   a routine-runner receipt. The copied PDC handoff identifies
   `lib/civic-data/read-model.ts::readPromotedCivicData(recordClass, scope,
   {store, now, bypassCache: true})` as the validated current/LKG reading.
   Fleet-to-source/class/scope/candidate/version bindings require PDC's final
   contract; they cannot be inferred from old fact or meeting IDs. This delta
   deliberately does not adapt or claim permanent proof.
3. Publisher mounting: the fleet/integration owner must compose this read cache
   inside the authorized permanent publisher's normal snapshot write after those
   selector/root and `CONSOLE_PUBLISHER` authority inputs are settled. No new
   publisher process or permission is introduced here.
4. Served operation: later verify the configured Admin control-plane read access,
   authorized runner publication, cross-cycle retention, page/Refresh parity and
   exact current/LKG/served bindings. The handoff's runtime DSN/directory claims
   were not treated as fresh production measurements in this session.

These are fleet/integration follow-ups with PDC contract inputs. They do not add
work to PDC's completion denominator. No live verification or operational write
is authorized by this local delta. Build evidence is recorded separately; an
import-only pass does not satisfy the application-build requirement.

## PDC coordination received during this delta

The PDC session supplied interface facts at provisional candidate
`1b8c63f7586bf7255c7ccbcc29e6753361f0f1f1`; they are not final deployed proof.
No PDC worktree or candidate was modified or used as a test/build target.

- Permanent Admin already uses `lib/civic-data/observability-server.ts::readRoutineDataObservability`
  via `/admin/sources`. Its inputs are `DATABASE_URL` and
  `WTP_BUILD_COMMIT/BRANCH/CONTEXT`. The store function
  `observability-store.ts::readRoutineDataObservabilityFromConnection(connection,
  {now, currentReaderBuild})` reads canonical `civic_data_candidates/events/promotions`
  in one read-only RepeatableRead snapshot. Reuse this permanent path; do not copy
  permanent evidence into the historical filesystem cache or another ledger.
- `runner-receipt.ts::parseRoutineRunnerReceipt` and
  `durableRoutineRunnerReceiptIssue(receipt, expected{id, sourceId, recordClass,
  scope}, store, SUCCESS|HELD)` bind the candidate, state, validation receipt,
  current pointer and LKG. Runner fields include source, candidateId,
  acquisitionSucceeded, state, decision, promotedVersion and lastKnownGoodVersion.
- `RoutineCivicDataSupervisorOutcome.taskReceipts` binds task/source/class/scope
  and checked receipt. Its `readerReadbacks` binds contract/source/class/scope/
  projection and exact `ReaderProjectionReadbackReceipt`. Reader receipt v2
  includes versionId, pointerKey, observedAt, typed-reader evidenceKind,
  verifierId/verifierCodeSha and PASS/FAIL status. A pointer or successful runner
  alone cannot establish served publication.
- PDC confirmed no historical `promotionReceipts` selector in current lib source.
  The historical selector/archive contract is an explicit fleet/integration
  dependency, not a request to restore a producer or extend PDC's acceptance scope.
- Final authority/connection inputs are expected in PDC's
  `.runtime/PDC_V2_CODEX_COMPLETION_HANDOFF.md`. Until that authorized handoff,
  `receiptSource.permanentAuthority` remains `NOT_CONNECTED`.

The supported split is therefore **historical runner archive → existing owner
snapshot**, alongside **permanent canonical database → existing PDC observability**.
The permanent-to-fleet identity adapter and exact served proof join are pending;
this delta resolves the historical Admin transport, not those separate bindings.
