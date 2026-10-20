import { contentHash } from "../control-plane/ids.ts";
import { OWNER_SURFACE_FORMAT_VERSION } from "../control-plane/owner-surface.ts";
import { canonicalJson, AppendOnlyViolation, type AggregateRepository, type ControlPlaneRepositories, type Persisted } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { registryJurisdictions } from "./state-scopes.ts";
import { invalidateReaderCache, type ReaderCachePurger } from "../reader/cache.ts";
import { countVitalSign } from "../db/transfer-by-caller.ts";
import { VITAL_COUNTERS } from "../control-plane/vital-signs.ts";

export const PUBLICATION_FLOW_LOG_KEY = "publication-flow";

type PublicationItem = Pick<WorkItem, "id" | "publicationOutcome"> & {
  readonly autonomousPlan?: Pick<NonNullable<WorkItem["autonomousPlan"]>, "publication" | "jurisdiction">;
};

/** The body's visible attempt changes only after its outcome has been retained successfully. */
export async function saveWorkerPublicationOutcome<T extends PublicationItem>(
  repos: { readonly workItems: Pick<AggregateRepository<T>, "compareAndSet"> }, current: Persisted<T>,
  outcome: NonNullable<WorkItem["publicationOutcome"]>, at: string, options: { readonly purge?: ReaderCachePurger } = {},
): Promise<Persisted<T>> {
  const saved = await repos.workItems.compareAndSet(current.id, current.revision, { ...current.value, publicationOutcome: outcome }, at);
  const plan = current.value.autonomousPlan;
  if (plan?.publication?.bodyId && canonicalJson(current.value.publicationOutcome) !== canonicalJson(outcome)) {
    const bodyStates = registryJurisdictions(plan.publication.bodyId);
    const states = bodyStates.length ? bodyStates : registryJurisdictions(plan.jurisdiction);
    await invalidateReaderCache(states.length ? { states } : { national: true }, options.purge);
  }
  return saved;
}

export interface PublicationFlowReceipt {
  readonly candidateId: string;
  readonly workerResultId: string;
  readonly stage: "CHECKED" | "LIVE";
  readonly records: number;
  readonly changedRecords: number;
  readonly versionId: string | null;
}
export async function recordPublicationFlow(repos: Pick<ControlPlaneRepositories, "ownerDigests">, candidateId: string,
  receipt: Omit<PublicationFlowReceipt, "candidateId">, at: string): Promise<void> {
  if (!Number.isSafeInteger(receipt.records) || receipt.records < 0 || !Number.isSafeInteger(receipt.changedRecords) ||
      receipt.changedRecords < 0 || receipt.changedRecords > receipt.records || (receipt.stage === "LIVE" && !receipt.versionId)) throw Error("PUBLICATION_FLOW_INVALID");
  const digestId = `publication-flow:${contentHash(canonicalJson([candidateId, receipt.stage]))}`;
  const prior = () => repos.ownerDigests.readRecentWhere(PUBLICATION_FLOW_LOG_KEY, ["digestId"], digestId, 1, { digestId: true });
  if ((await prior()).length) return;
  try {
    await repos.ownerDigests.append(PUBLICATION_FLOW_LOG_KEY, digestId, { formatVersion: OWNER_SURFACE_FORMAT_VERSION,
      digestId, writtenAt: at, headline: receipt.stage === "LIVE" ? "Verified records reached the reader" : "Records passed the publication check",
      lines: [], cycleOk: null, testedSha: null, publicationFlow: { candidateId, ...receipt } }, at);
  } catch (error) {
    if (!(error instanceof AppendOnlyViolation) || !(await prior()).length) throw error;
    return;
  }
    /* Counts new or changed records (a recheck earns none), once, when the receipt is first written. */
  if (receipt.stage === "LIVE") countVitalSign(VITAL_COUNTERS.factsLive, receipt.changedRecords);
}
