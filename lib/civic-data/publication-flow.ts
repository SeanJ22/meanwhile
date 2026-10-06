import { contentHash } from "../control-plane/ids.ts";
import { OWNER_SURFACE_FORMAT_VERSION } from "../control-plane/owner-surface.ts";
import { canonicalJson, AppendOnlyViolation, type ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { notePublishedRecords, type PublishedFactSample } from "./publication-vitals.ts";

/** Aggregate measurements in the existing operational activity log. No facts,
 * quotes or publisher payloads are copied. A check and typed-reader delivery
 * are separate observations of the existing publication receipt. */
export const PUBLICATION_FLOW_LOG_KEY = "publication-flow";
export interface PublicationFlowReceipt {
  readonly candidateId: string;
  readonly workerResultId: string;
  readonly stage: "CHECKED" | "LIVE";
  readonly records: number;
  readonly changedRecords: number;
  readonly versionId: string | null;
}
export async function recordPublicationFlow(repos: Pick<ControlPlaneRepositories, "ownerDigests">, candidateId: string,
  receipt: Omit<PublicationFlowReceipt, "candidateId">, at: string, samples?: readonly PublishedFactSample[]): Promise<void> {
  if (!Number.isSafeInteger(receipt.records) || receipt.records < 0 || !Number.isSafeInteger(receipt.changedRecords) ||
      receipt.changedRecords < 0 || receipt.changedRecords > receipt.records || (receipt.stage === "LIVE" && !receipt.versionId)) throw Error("PUBLICATION_FLOW_INVALID");
  const digestId = `publication-flow:${contentHash(canonicalJson([candidateId, receipt.stage]))}`;
  const prior = () => repos.ownerDigests.readRecentWhere(PUBLICATION_FLOW_LOG_KEY, ["digestId"], digestId, 1, { digestId: true });
  if ((await prior()).length) return;
  try {
    const appended = await repos.ownerDigests.append(PUBLICATION_FLOW_LOG_KEY, digestId, { formatVersion: OWNER_SURFACE_FORMAT_VERSION,
      digestId, writtenAt: at, headline: receipt.stage === "LIVE" ? "Verified records reached the reader" : "Records passed the publication check",
      lines: [], cycleOk: null, testedSha: null, publicationFlow: { candidateId, ...receipt } }, at);
    if (appended.appended && receipt.stage === "LIVE") {
      notePublishedRecords(repos.ownerDigests, { id: digestId, at, changedRecords: receipt.changedRecords, samples });
    }
  } catch (error) {
    if (!(error instanceof AppendOnlyViolation) || !(await prior()).length) throw error;
  }
}
