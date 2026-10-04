# Admin continuation

Read the current `board/briefs` common/admin briefs, `plan/plan.md`, main rulings, River assignments and returns before writing. This run was authorized by the launch record on `board/river`; admin remained assigned to Codex throughout. Actual runtime model identity was not exposed. Prompt text did not change the model.

Resume `stream/admin`; preserve every checkpoint. Application checkpoint: `916e446c73f8a2787fc7147cd48d9c01245c23aa`. No READY commits exist. Exact checks are in `.factory/admin-checks.md`.

## Saved implementation

- BR-05 foundation: typed settings registrations, per-key validation, detective shut threshold (default 3), previous-value history, stale-safe undo via `config.setSetting`, reader-facing-only publication through a separate monotonic edge CAS, cache-tag purge, reader settings route/read helper, and meeting interval validators that preserve the adopted floors.
- BR-01 foundation: bounded newest-first projection joined to receipts, per-place filtering, stable source-position paging, reverse gateway map, saved original targets alongside derived intent IDs, current runner confirmation, and an in-memory provider matching the production page interface. Unknown legacy places remain unknown.

Both remain WIP. Settings still need their runner/detective connection and Workers readback; final UI/live acceptance is unverified. Reader settings key registration by other lanes must be imported in the settings/gateway runtime. Public publication retry/readback, downstream consumers, and the Settings view still need integration/verification. History still needs full/live acceptance and BR-36's writer/trigger changes; old bulk receipts can lack durable per-place links. The file repository has no history-page adapter; production Postgres and memory have it.

## River dependencies and returns

- Hunters: each runner pass re-reads AdminConfig, then uses `readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3)` from `lib/control-plane/settings.ts`. Auditors DP-02 consumes the resulting threshold. The shared runner file belongs to hunters; this worker did not edit it.
- Returned BR-08 hook from measures: `expansion.scope.set` already delegates to `validateScopeGeography`, with no separate gateway type restriction. Verify state support once measures' scopes.ts changes are integrated into river. There is no extra admin enum to widen.
- Returned DB-09 hook from registry: render `listDoors(repos.doors)` and door.save receipts in the command center once registry's files and repository contract are integrated. At this handoff, river was still `0b31938f52ae18ae783cff9b9ddc1df11388cc4a` and contained neither `lib/doors/registry.ts` nor `repos.doors`; don't fabricate them or treat a stream claim as integration.
- Required browser/FULL checks need an allowed browser-enabled environment. Standard installation in this cloud is denied by HTTP policy. River can verify or assign the existing measures Claude worker through the recorded handoff rules; Sean is not being asked to restart this worker.

## Remaining lane scope

All 29 steps remain unclaimed as complete: BR-01, BR-03, BR-05, BR-12, BR-15, BR-24, BR-07, BR-37, BR-02, BR-04, BR-09, BR-10, BR-11, BR-26, BR-35, BR-36, BR-39, CH-12, CH-14, BR-13, BR-20, BR-06, BR-18, BR-16, BR-27, BR-29, BR-17, BR-19, BR-28. Take returned hooks first, then follow the brief's first-ready order and actual integrated dependencies. BR-05 remains the highest-impact foundation, followed by BR-03 and BR-01. Honor spending settings, the no-hunts authorization and parked SC-17. No owner decision or missing credential has been invented.

The lock is released by this handoff. A continuation must acquire a new lock under the authoritative assignment; a Codex run must exit without writing if River assigns admin to Claude.
