# Acquisition-to-reader implementation — 2026-09-28

Lead and workers: GPT-6 Sol. Base: afc590ea2294b7e4defa0f50b4ea2eabea5a0508. Shared checkout: C:/Users/seanj/dev/meanwhile-delivery-repair. No worker commits, releases, production writes, new hunts or paid research independently. Lead integrates. Existing Prepare 85635 expansion owns release/runner/held-meeting wiring until explicit handoff.

## File ownership

Lead owns shared contracts: lib/control-plane/workers/types.ts, lib/control-plane/workers/research-types.ts, lib/control-plane/workers/engineering-types.ts, lib/control-plane/work-item.ts, lib/control-plane/attempt.ts, lib/control-plane/repository/types.ts, lib/control-plane/readiness/standard.ts, lib/control-plane/readiness/standard.json, lib/control-plane/delivery-trail.ts, lib/civic-data/contracts.ts, lib/civic-data/manual-contracts.ts, all new lib/control-plane/readiness/checklist-* files, integration scripts and the completion ledger. Request changes to these; do not edit them concurrently.

A owns these existing files: lib/control-plane/scheduler/scout-tools.ts, scout-executor.ts, scout-result.ts, scout-contract.ts, scout-candidates.ts, field-manual-scout.ts (all under that scheduler directory); lib/control-plane/workers/generalized-parser.ts, parser.ts, plan-repair.ts, engineering.ts, engineering-candidate.ts, acquirer.ts, detective.ts, field-manual-learnings.ts, evidence-projection.ts; lib/control-plane/evidence/parser-boundary.ts, read-only-vault.ts, vault-restore.ts; lib/control-plane/field-manual.ts. A may add acquisition helpers beside those files and tests named acquisition-repair-*.test.ts. Request any additional existing path first.

B owns: lib/control-plane/workers/coordinator.ts, runtime.ts, scheduling.ts, scout-scheduling.ts; lib/control-plane/scheduler/hunt-continuation.ts, dispatch.ts, durable.ts, cycle-phases.ts, research-policy.ts, scout-search.ts; lib/control-plane/expansion/assignment-budget.ts, membership.ts; lib/control-plane/provider-billing-attribution.ts, cost-panel.ts, assignment-completion.ts; lib/control-plane/readiness/compute.ts; lib/control-plane/admin-view/work-view.ts, scope-work.ts, money-view.ts, hunt-activity.ts; app/(admin)/_mw/data/scope-work.ts, spend-store.ts, live-pipeline.ts, hunt-source-progress.ts; app/api/admin/action/route.ts, app/api/admin/live/route.ts. B may add backend helpers alongside these and tests named execution-accountability-*.test.ts. Request other existing files first.

C owns: lib/civic-data/worker-roster-publication.ts, worker-body-directory.ts, worker-reader-contracts.ts; lib/control-plane/workers/generalized-validator.ts, generalized-auditor.ts, record-verification.ts; components/map/map-entry.tsx, coverage-notice.tsx; lib/registry/coverage.ts; components/funding/funding-block.tsx; all presentation .tsx/.css files under app/(admin)/_mw/ excluding data/, and app/(admin)/admin/page.tsx. C may add publication/presentation helpers beside these and tests named delivery-experience-*.test.ts. Request additional existing files first.

No edits to lib/control-plane/discovery/derived-wiring.ts, derived-wiring-reading.ts, lib/control-plane/workers/held-meeting-contract.ts, or runtime checkout until the existing session hands them off. No broad tests/builds in parallel; workers run focused tests, lead owns integrated validation. Existing tests adjacent to an owned implementation may be edited only after reporting their exact paths.

## Shared interfaces

Additional ownership assigned during integration: A owns autonomous-plan, record-evidence, hunt-source-tasks, manual-producer-invocation, operational-references, source-authority, manual-contracts, reader-verification and the jurisdiction enumeration command. B owns discovery/search-runtime, expansion/dispatch-work and runner-load, scheduler/provider-inputs, assignment-view, fleet-safety, worker model-audit/research/standing runtime, and freshness-shadow. C owns the shared Admin scope/page-base, registry coverage/server, roster provenance, candidate blurbs and relevant reader contact/meeting surfaces. Lead owns pilot-runner, publish-owner-snapshot, body-attempt-read, all checklist modules and shared result/work-item types. Exact-path extensions were coordinated before edits.

Use existing work/attempt/artifact/candidate/publication/served IDs and existing stores. Extend contracts additively; no replacement queue, budget store or dashboard. WorkerEvidence already supplies artifactId, contentHash, acquiredByAttemptId, canonicalUrl, retrievedAt, sourceId, methodRouteId. Extraction must retain supported source fields and distinguish public office contact from private/personal contact. A passes those scalar fields through existing generalized rows; C consumes them with provenance and preserves verified values on incomplete updates. Types changes are lead-owned.

Admin backend/presentation handoff: B sends C exact exported return types before changing signatures. Existing snapshots remain readable. Amounts retain knownUsd, unpricedCount, reservedUsd, allowance and observation/scope; null never erases known amounts. Controls return saved state or an explicit failure through current action receipts. Counts name units and full populations. Lead supplies checklist definitions and score contract; work progress remains separate from reader coverage.

Lineage links requirement/object/period to work, attempts, held evidence, extraction, verification, accepted version and actual public witness. Source publication and Meanwhile publication remain separate. New/updated/reused/retained are evidence-based dispositions, never inferred from a completed job. Unknown applicability, missing read, stale proof, unverified delivery and missing capability remain explicit.

## Checkpoints

1. Focused baseline and all 325 definitions assigned, historical preparation disclosed.
2. Held Sierra Vista roster flows through normal processing to a new public record; supported fields survive; Admin explains source, checks, status and cost. Existing session owns meeting recovery.
3. All applicable families implemented and reconciled, with exact remaining source/budget limitations.
4. Integrated required checks, merge/deployment, separate runner adoption, public and ADMIN-01–15 acceptance.

Morning report due 2026-09-28 06:55 America/Phoenix (13:55 UTC), without treating the checkpoint as completion or new spending authority.
