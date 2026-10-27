import { placeReadConnection } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { ArtifactRecord, ControlPlaneRepositories, RecordProjection } from "../repository/types.ts";
import type { WorkItem } from "../work-item.ts";
import type { WorkerResultRecord } from "./types.ts";

/** Only a missing next computation needs planning; an existing task remains the canonical retry cursor. */
export const HELD_WORK_INPUT_IDS_SQL = `WITH planned AS MATERIALIZED (
  SELECT id,value FROM cp_work_items
  WHERE value#>>'{autonomousPlan,contract,schemaVersion}'='2'
    AND value#>>'{autonomousPlan,contract,recordClass}' NOT IN ('HELD_MEETING_DETAILS','HELD_SUBJECT_DETAILS')
    AND ($2::text IS NULL OR cp_control_state(value)=$2)
), acquisitions AS MATERIALIZED (
  SELECT a.record FROM planned w JOIN cp_log_artifacts a ON a.record->>'workItemId'=w.id
  WHERE coalesce(a.record->>'partial','false')='false' AND EXISTS (
    SELECT 1 FROM cp_log_worker_results r WHERE r.log_key=w.id AND r.record->>'workItemId'=w.id
      AND r.record#>>'{result,role}'='ACQUIRER' AND r.record#>>'{result,verdict}'='ACQUIRED'
      AND r.record#>>'{completion,closedAttempt,outcome}'='COMPLETED'
      AND r.record#>>'{completion,closedAttempt,id}'=r.record->>'attemptId'
      AND r.record#>>'{result,source,subjectId}'=w.value->>'subject'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(r.record#>'{result,artifacts}','[]'::jsonb)) captured
        WHERE captured->>'artifactId'=a.record->>'artifactId' AND captured->>'completeness'='COMPLETE'
          AND captured->>'byteCount'=a.record->>'byteLength' AND captured->>'byteCount' ~ '^[1-9][0-9]*$'
          AND captured->>'contentHash'=a.record->>'contentHash' AND captured->>'canonicalUrl'=a.record->>'canonicalUrl'
          AND captured->>'acquisitionAttemptId'=a.record->>'attemptId')
  ) AND w.value->>'subject'=w.value#>>'{autonomousPlan,contract,subjectId}'
    AND w.value#>'{autonomousPlan,contract,sourceScope,canonicalUrls}' ? (a.record->>'canonicalUrl')
), current_tasks AS MATERIALIZED (
  SELECT t.id,t.value FROM cp_route_tasks t JOIN planned w ON t.value->>'workItemId'=w.id
  WHERE t.value#>>'{workerTask,implementationVersion}'=$1
    AND t.value#>>'{workerTask,schemaVersion}'='1'
    AND t.value#>'{workerTask,contract}'=w.value#>'{autonomousPlan,contract}'
    AND t.value#>>'{workerTask,purpose}' IS NULL
    AND t.value#>>'{workerTask,acquisition}' IS NULL
    AND t.value#>>'{workerTask,auditEscalation}' IS NULL
    AND t.value#>>'{workerTask,auditScope}'='CAPTURED_ARTIFACT'
)
SELECT DISTINCT a.record->>'workItemId' AS id FROM acquisitions a WHERE
  NOT EXISTS (SELECT 1 FROM current_tasks t WHERE t.value->>'workItemId'=a.record->>'workItemId'
    AND t.value#>>'{workerTask,artifactId}'=a.record->>'artifactId' AND t.value#>>'{workerTask,role}'='PARSER'
    AND t.value#>>'{workerTask,producerResultId}' IS NULL AND t.value#>>'{workerTask,validatorResultId}' IS NULL)
  OR EXISTS (SELECT 1 FROM current_tasks p JOIN cp_log_worker_results r ON r.record->>'routeTaskId'=p.id
    WHERE p.value->>'workItemId'=a.record->>'workItemId' AND p.value#>>'{workerTask,artifactId}'=a.record->>'artifactId'
      AND p.value#>>'{workerTask,role}'='PARSER' AND r.record#>>'{result,role}'='PARSER' AND r.record#>>'{result,verdict}'='EXTRACTED'
      AND NOT EXISTS (SELECT 1 FROM current_tasks v WHERE v.value->>'workItemId'=a.record->>'workItemId'
        AND v.value#>>'{workerTask,artifactId}'=a.record->>'artifactId' AND v.value#>>'{workerTask,role}'='VALIDATOR'
        AND v.value#>>'{workerTask,validatorResultId}' IS NULL
        AND v.value#>>'{workerTask,producerResultId}'=r.record->>'id'))
  OR EXISTS (SELECT 1 FROM current_tasks v JOIN cp_log_worker_results r ON r.record->>'routeTaskId'=v.id
    WHERE v.value->>'workItemId'=a.record->>'workItemId' AND v.value#>>'{workerTask,artifactId}'=a.record->>'artifactId'
      AND v.value#>>'{workerTask,role}'='VALIDATOR' AND r.record#>>'{result,role}'='VALIDATOR'
      AND (r.record#>>'{result,verdict}'='PASS' OR r.record#>>'{result,extractionVerdict}'='PASS')
      AND NOT EXISTS (SELECT 1 FROM current_tasks audit WHERE audit.value->>'workItemId'=a.record->>'workItemId'
        AND audit.value#>>'{workerTask,artifactId}'=a.record->>'artifactId' AND audit.value#>>'{workerTask,role}'='ADVERSARIAL_AUDITOR'
        AND audit.value#>>'{workerTask,producerResultId}'=v.value#>>'{workerTask,producerResultId}'
        AND audit.value#>>'{workerTask,validatorResultId}'=r.record->>'id'))
ORDER BY id`;

export type HeldWorkerWorkItem = Pick<WorkItem, "id" | "subject"> & {
  readonly autonomousPlan?: Pick<NonNullable<WorkItem["autonomousPlan"]>, "contract">;
};
export type HeldWorkerResult = Pick<WorkerResultRecord, "id" | "routeTaskId" | "attemptId" | "workItemId"> & {
  readonly result: {
    readonly role: string;
    readonly verdict: string;
    readonly extractionVerdict?: string;
    readonly source?: { readonly subjectId?: string };
    readonly artifacts?: readonly { readonly artifactId: string; readonly completeness: string; readonly byteCount: number;
      readonly contentHash: string; readonly canonicalUrl: string; readonly acquisitionAttemptId: string }[];
  };
  readonly completion: { readonly closedAttempt: { readonly id: string; readonly outcome: string | null } };
};

const RESULT_INPUTS: RecordProjection = { id: true, routeTaskId: true, attemptId: true, workItemId: true,
  result: ["role", "verdict", "extractionVerdict", "source", "artifacts"], completion: ["closedAttempt"] };

export async function readHeldWorkerWorkIds(repos: ControlPlaneRepositories, implementationVersion: string): Promise<readonly string[]> {
  const sql = placeReadConnection(repos);
  if (sql) return (await boundedQuery(sql, { operation: "cp_log_worker_results.heldWorkInputIds", callClass: "PAGE" },
    HELD_WORK_INPUT_IDS_SQL, [implementationVersion, repos.planningState ?? null]) as { id: string }[]).map(row => row.id);
  // File and memory stores select log keys, then read each named work item; they never load all held result bodies.
  return repos.workerResults.keysWhere(["result", "role"], "ACQUIRER");
}

export async function readHeldWorkerInputs(repos: ControlPlaneRepositories, workItemId: string): Promise<{
  readonly item: HeldWorkerWorkItem | null;
  readonly records: readonly HeldWorkerResult[];
  readonly artifacts: readonly ArtifactRecord[];
}> {
  const held = await repos.workItems.readNarrowed(workItemId, { id: true, subject: true, autonomousPlan: ["contract"] });
  const item = held?.value as HeldWorkerWorkItem | undefined;
  if (!item || item.id !== workItemId || !item.autonomousPlan?.contract || typeof item.subject !== "string") return { item: null, records: [], artifacts: [] };
  const records = await repos.workerResults.readRecentWhere(workItemId, ["workItemId"], workItemId, Number.MAX_SAFE_INTEGER, RESULT_INPUTS) as readonly HeldWorkerResult[];
  const artifacts = (await Promise.all((await repos.artifacts.keysWhere(["workItemId"], workItemId))
    .map(key => repos.artifacts.readWhere(key, ["workItemId"], workItemId)))).flat();
  return { item, records: [...records].reverse(), artifacts: [...artifacts].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)) };
}
