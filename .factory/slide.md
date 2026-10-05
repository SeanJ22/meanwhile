build_state: active
worker: codex-slide
provider: Codex
run_id: codex-slide-005c2146fa5b46a1b890f9f80e2de516
lock: codex-slide-005c2146fa5b46a1b890f9f80e2de516
heartbeat: 2026-10-05T18:33:30.424188Z
on_river: CP-01, CP-19 via 85a0ad6, released on main ecf402600401783b094837c29e0c515eadbdb843
ready: CP-01, CP-19 (READY commit is the one whose subject starts READY: CP-01, CP-19; source tested at 3233af52d3d9f4a785ea16b1f1fadda4f36c2a45)
checks: Reader-edge return: 91/91 focused tests passed; TypeScript repaired stale .next route types, rerun pending; FULL still required before READY. Prior CP-01/CP-19 evidence preserved.
working_on: River return: expose local-folder/no-store/non-composable reader-edge publication failure; then next ready lane steps
waiting_on: BX-01 canonical repository/schema hook owned by River
returned: 18:20Z reader-edge return built: supervisor refuses local store unless WTP_READER_EDGE_LOCAL_OK=1, missing store and NOT_COMPOSABLE fail; logs and durable supervisor result carry actual store kind and sequence. Admin screen hook pending.
needs_hook: admin (via River): routine reader publication now persists runtimeOutcome.readerEdge {ok, readerEdge, store, sequence, detail} in existing ownerDigests and failure READER_EDGE_PUBLISH_FAILED. ownerDigestAttention reports plain-English RED. Current Admin has no latest-digest consumer (tests/routine-civic-data-admin-digest.test.tsx documents its removal). Connect latest ROUTINE_CIVIC_DATA_SUPERVISOR digest to runner/health view; show headline/happened/action, keep readerEdge.store, sequence and failure detail behind Technical details. BX-01 still needs River boxFindings canonical repository/schema; original hooks preserved in slide-continuation.md.
needs_Sean: none
seen_not_fixed: full suite under 4 cores takes about 41 minutes and the two slowest files can time out under load.
needs_River: Route Admin digest hook above; awaiting existing BX-01 repository/schema hook. No owner question.

CP-02 hooks in preparation: source-settings.ts registers publication.sourceHosts and publication.sourceKinds; admin must import that registration module in its settings registry/gateway process. Canonical campaign identity must be supplied from the verified candidate binding when constructing Section3Page.campaign. No CP-02 READY claim yet.
