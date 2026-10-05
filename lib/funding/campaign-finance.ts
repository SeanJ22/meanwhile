import { campaignFinanceRecordIssue, type CampaignFinanceRecord } from "./campaign-finance-reader.ts";
import type { BallotSet } from "../ballot/types.ts";
import type { DoorRecord } from "../doors/registry.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
import { captureIntact, section3SourceReceipt } from "../civic-data/worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { readFinanceDoor, type SavedFinanceResponse } from "./finance-door-reader.ts";
import { bindFinanceDoorFilings } from "./finance-door-bindings.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";

/** Replay source bytes with the door's field map, then bind only source-stated candidate identities. */
export interface CapturedFinanceResponse extends SavedFinanceResponse {
  readonly rawHash: string;
  readonly publisher: string;
  readonly httpStatus: number | null;
  readonly transport: string;
  readonly partial: boolean;
  readonly sourcePolicy?: import("../control-plane/promotion/source-kinds.ts").SourcePolicy;
}

export function campaignFinancePackage(input: {
  readonly door: DoorRecord;
  readonly responses: readonly (SavedFinanceResponse | CapturedFinanceResponse)[];
  readonly captures: readonly WorkerPublicationCapture[];
  readonly ballots: readonly BallotSet[];
  readonly now: string;
}) {
  const sourceTexts = new Map<string, string>();
  const read = readFinanceDoor(input.door, input.responses, (source, text) => sourceTexts.set(`${source.url}\n${source.hash}`, text));
  if (!read.paginationComplete) throw new Error("The finance source's bounded filing read is incomplete.");
  const used = read.captures.map(source => {
    const response = input.responses.find(row => row.url === source.url && row.retrievedAt === source.retrievedAt &&
      "rawHash" in row && row.rawHash === source.hash) as CapturedFinanceResponse | undefined;
    const capture = input.captures.find(row => row.evidence.canonicalUrl === source.url &&
      (row.evidence.sourceDocument?.contentHash ?? row.evidence.contentHash) === `sha256-${source.hash}` && row.evidence.retrievedAt === source.retrievedAt);
    const rawVerified = response && response.complete && !response.partial && response.transport === "REACHABLE" &&
      response.httpStatus !== null && response.httpStatus >= 200 && response.httpStatus < 300 && response.publisher.trim();
    if (!rawVerified && (!capture || !captureIntact(capture))) throw new Error("Finance bytes have no complete saved source capture.");
    const page = section3Page({ url: source.url, text: sourceTexts.get(`${source.url}\n${source.hash}`)!, retrievedAt: source.retrievedAt,
      linkingPage: linkingPageFrom(source.url, input.captures.filter(captureIntact).map(row => row.evidence)),
      sourcePolicy: rawVerified ? response!.sourcePolicy : capture!.sourcePolicy }, "CAMPAIGN_FINANCE_FILING", input.now);
    if (!page.ok) throw new Error(page.reason ?? "Finance source is not verified.");
    return { ...source, publisher: rawVerified ? response!.publisher : capture!.evidence.sourceId,
      httpStatus: rawVerified ? response!.httpStatus! : capture!.httpStatus! };
  });
  const bound = bindFinanceDoorFilings({ read, ballots: input.ballots,
    agency: typeof input.door.config.agency === "string" ? input.door.config.agency : used[0].publisher });
  const records: CampaignFinanceRecord[] = bound.bound.map(({ filing, record }) => ({
    id: filing.id, ocdId: filing.ocdId, sourceUrl: filing.sourceUrl, sourceHash: filing.sourceHash,
    collectedAt: filing.retrievedAt, reportId: filing.reportId,
    record: { ...record, provenance: { ...record.provenance, verifiedAt: input.now } },
  }));
  if (!records.length) throw new Error("No filed candidate/office/cycle/jurisdiction identity is verified; unmatched rows remain owed work.");
  for (const row of records) { const issue = campaignFinanceRecordIssue(row); if (issue) throw new Error(issue); }
  const linkingCaptures = input.captures.filter(captureIntact).filter(row => used.some(source =>
    linkingPageFrom(source.url, [row.evidence])));
  const sources = used.map(source => ({ requestedUrl: source.url, finalUrl: source.url, publisher: source.publisher,
    sourceClass: "OFFICIAL_PUBLISHER" as const, retrievedAt: source.retrievedAt, httpStatus: source.httpStatus, rawHash: source.hash,
    reviewOutcome: "SUPPORTED" as const,
    reviewedEvidence: "Code replayed complete saved filing bytes and matched filed candidate name, office, cycle and exact jurisdiction to one held ballot candidacy; periods stay separate." }));
  return { unbound: bound.unbound, package: {
    contractId: "campaign-finance", version: `campaign-finance-v2:${new Date(input.now).toISOString()}`, sourceThrough: used.map(source => source.retrievedAt).sort().at(-1)!,
    sourceReceipt: { contractVersion: 1, reviewedAt: input.now, reviewedBy: "Finance door field-map reader",
      sources: [...sources, ...section3SourceReceipt(linkingCaptures, input.now, "Finance door field-map reader", "Official publisher links to the filing source.").sources] },
    payload: { kind: "campaign-finance", records },
  } satisfies ManualProjectionPackage };
}

export async function publishCampaignFinance(store: RoutineDataStore, input: Parameters<typeof campaignFinancePackage>[0]) {
  const built = campaignFinancePackage(input);
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(built.package, store, input.now);
  const published = await processRegisteredManualCandidate(store, "campaign-finance", candidate, input.now, expectedBaseVersionId);
  return { ...published, unbound: built.unbound, acceptedRecordIds: built.package.payload.records.map(row => row.id) };
}

/** Called by the existing leased door worker with that place's admitted held inputs. */
export async function runFinanceDoorPublication(input: Parameters<typeof campaignFinancePackage>[0] & {
  readonly repos: Pick<ControlPlaneRepositories, "workItems">;
  readonly store: RoutineDataStore;
  readonly workItemId: string;
  readonly workerResultId: string;
}) {
  const current = await input.repos.workItems.mustRead(input.workItemId);
  const plan = current.value.autonomousPlan;
  if (!plan || plan.publication?.contractId !== "campaign-finance" || plan.contract.recordClass !== "CAMPAIGN_FINANCE_FILING") {
    throw new Error("This work item is not an admitted campaign-finance publication.");
  }
  const state = jurisdictionFromOcdId(input.door.ocdId ?? "")?.usps;
  const admitted = plan.contract.schemaVersion === 2 ? plan.contract.jurisdiction.state.toUpperCase().replace(/^US-/, "") : null;
  if (!state || admitted !== state || input.ballots.some(ballot => ballot.election.state !== state)) {
    throw new Error("Finance publication must stay inside its admitted state's held inputs.");
  }
  let candidateId: string | null = null, versionId: string | null = null;
  let outcome: NonNullable<WorkItem["publicationOutcome"]>;
  try {
    const published = await publishCampaignFinance(input.store, input);
    candidateId = published.candidate.candidate.id;
    versionId = published.promoted?.versionId ?? null;
    if (!published.promoted || published.readerReadback?.status !== "PASS") throw new Error(published.candidate.failureDetail ?? "Campaign finance has not reached its typed reader.");
    outcome = { at: input.now, workerResultId: input.workerResultId, candidateId, versionId,
      status: published.unbound.length ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
      code: published.confirmed ? "VERIFIED_RESULT_REUSED" : "FILED_CAMPAIGN_FINANCE_PUBLISHED",
      acceptedRecordIds: published.acceptedRecordIds,
      detail: `${published.acceptedRecordIds.length} source-verified filing(s) published with separate reporting periods; ${published.unbound.length} filing(s) still need candidate/office/cycle/jurisdiction binding.`,
      ...(published.unbound.length ? { recovery: "WORKER" as const } : {}) };
  } catch (error) {
    const detail = sanitizedErrorDiagnostic(error);
    outcome = { at: input.now, workerResultId: input.workerResultId, candidateId, versionId, status: "HELD",
      code: "CAMPAIGN_FINANCE_PUBLICATION_HELD", detail, recovery: candidateId ? "PUBLISHER" : "WORKER" };
  }
  const latest = await input.repos.workItems.mustRead(input.workItemId);
  const saved = await input.repos.workItems.compareAndSet(input.workItemId, latest.revision,
    { ...latest.value, publicationOutcome: outcome }, input.now);
  if (!saved) throw new Error("The finance work-item outcome changed while its publication was being retained.");
  return { workItemId: input.workItemId, outcome };
}
