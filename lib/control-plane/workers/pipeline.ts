import { stateFromRegistryRuntimeContractId } from "../../civic-data/state-scopes.ts";
import { appendTransition, isPipelineRecord, scoutedFromScoutResult, type PipelineContext } from "../promotion/pipeline.ts";
import { PROMOTION_PIPELINE_FORMAT_VERSION, VERIFICATION_CHECKS, type TransitionRecord, type VerificationCheckName } from "../promotion/types.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { visitCompletedWorkerResults } from "../repository/worker-completion.ts";
import { isWorkerReaderContract } from "../../civic-data/worker-reader-contracts.ts";
import { withHistoryIndex } from "./streamed-history.ts";
import type { WorkerResultRecord } from "./types.ts";

const SCOUT_CONTEXT: PipelineContext = { artifactById: () => null, attemptRoleById: () => null };

/** Offer each completed Validator result through the existing pipeline as the check it ran. */
export async function projectFleetPipeline(repos: ControlPlaneRepositories): Promise<void> {
  await withHistoryIndex(async db => {
    db.exec(`CREATE TABLE results(sequence INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE result_artifacts(id TEXT PRIMARY KEY);
      CREATE TABLE pipeline_keys(id TEXT PRIMARY KEY);
      CREATE TABLE scouted_items(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE artifact_items(artifact TEXT PRIMARY KEY, item TEXT NOT NULL)`);
    const insertResult = db.prepare("INSERT INTO results VALUES(?,?)");
    const insertArtifact = db.prepare("INSERT OR IGNORE INTO result_artifacts VALUES(?)");
    let sequence = 0;
    await visitCompletedWorkerResults(repos, result => {
      if (result.result.role === "VALIDATOR") insertResult.run(sequence, JSON.stringify(result));
      sequence++;
      for (const id of result.inputArtifactIds) insertArtifact.run(id);
    });
    if (sequence === 0) return;
    const heldArtifact = db.prepare("SELECT id FROM result_artifacts WHERE id=?");
    await repos.scoutResults.readChangedSince(null, undefined, { page: async rows => {
      for (const {record: scout} of rows) for (const offered of scoutedFromScoutResult(scout)) {
        if (offered.artifactIds.some(id => heldArtifact.get(id))) await appendTransition(repos, offered, SCOUT_CONTEXT, offered.at);
      }
    } });
    const insertKey = db.prepare("INSERT OR IGNORE INTO pipeline_keys VALUES(?)");
    const insertScouted = db.prepare("INSERT OR IGNORE INTO scouted_items VALUES(?,?)");
    await repos.promotionPipeline.readChangedSince(null, undefined, { page: rows => {
      for (const {key, record} of rows) {
        insertKey.run(key);
        if (isPipelineRecord(record) && record.stage === "SCOUTED") insertScouted.run(record.itemId, JSON.stringify(record));
      }
    } });
    const bindArtifact = db.prepare("INSERT OR IGNORE INTO artifact_items VALUES(?,?)");
    // A shared artifact keeps its first item's attribution in canonical pipeline-key order.
    for (const row of db.prepare("SELECT s.id,s.body FROM scouted_items s JOIN pipeline_keys k ON k.id=s.id ORDER BY s.id").iterate()) {
      const scout = JSON.parse(row.body) as Extract<TransitionRecord, {stage: "SCOUTED"}>;
      for (const id of scout.artifactIds) bindArtifact.run(id, row.id);
    }
    const itemForArtifact = db.prepare("SELECT item FROM artifact_items WHERE artifact=?");
    for (const row of db.prepare("SELECT body FROM results ORDER BY sequence").iterate()) {
      const result = JSON.parse(row.body) as WorkerResultRecord;
      if (result.result.role !== "VALIDATOR") continue;
      // This class publishes through its typed reader door, which runs its own checks.
      const work = await repos.workItems.readNarrowed(result.workItemId, { autonomousPlan: ["publication"] });
      const contractId = (work?.value as { autonomousPlan?: { publication?: { contractId?: string } } } | undefined)?.autonomousPlan?.publication?.contractId;
      if (stateFromRegistryRuntimeContractId(contractId ?? "") || (contractId !== undefined && isWorkerReaderContract(contractId))) continue;
      let itemId: string | null = null;
      for (const id of result.inputArtifactIds) {
        const held = itemForArtifact.get(id)?.item;
        if (held && (itemId === null || held < itemId)) itemId = held;
      }
      if (itemId === null) continue;
      const base = { formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION as typeof PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${result.id}:pipeline:3`, itemId, at: result.endedAt,
        actor: { role: result.worker.role, lane: result.executionMode === "MODEL_ASSISTED" ? "BOUNDED_MODEL_WORKER" as const : "DETERMINISTIC" as const, instance: result.worker.instance }, workerResultId: result.id };
      const v = result.result;
      const pass = v.verdict === "PASS" && v.validatedRecordCount > 0;
      const detail: Record<VerificationCheckName, string> = {
        CLAIM_RESOLVES_TO_SOURCE_SPAN: `Validator ${result.id}: ${v.validatedRecordCount} record(s) with their values found on the saved page.`,
        CANONICAL_IDENTITY_UNIQUE: "Each record keeps its own source identity; one bad row holds only itself.",
        ASSERTION_CLASS_BURDENS: "§3: the page is official for this place and inside its freshness window.",
        NEUTRALITY_AND_RENDERING_SYMMETRY: "Not a judgment call under §3; the typed reader door renders it.",
        FALSE_ZERO: "Only records found on the page are offered; nothing is asserted absent.",
      };
      const offered: TransitionRecord = { ...base, stage: "VERIFIED", checks: VERIFICATION_CHECKS.map(name => ({ name, result: pass ? "PASS" as const : "FAIL" as const,
        detail: pass ? detail[name] : `Validator ${result.id} ${v.verdict}: ${v.findings.filter(f => f.severity !== "INFO").map(f => f.code).join(", ") || "no record met its minimum facts"}` })) };
      const context: PipelineContext = { ...SCOUT_CONTEXT, workerResultById: id => id === result.id ? result : null };
      await appendTransition(repos, offered, context, result.endedAt);
    }
  });
}
