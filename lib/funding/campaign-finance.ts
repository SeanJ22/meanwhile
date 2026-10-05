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

/** Replay source bytes with the door's field map, then bind only source-stated candidate identities. */
export function campaignFinancePackage(input: {
  readonly door: DoorRecord;
  readonly responses: readonly SavedFinanceResponse[];
  readonly captures: readonly WorkerPublicationCapture[];
  readonly ballots: readonly BallotSet[];
  readonly now: string;
}) {
  const read = readFinanceDoor(input.door, input.responses);
  if (!read.paginationComplete) throw new Error("The finance source's bounded filing read is incomplete.");
  const used = read.captures.map(source => {
    const capture = input.captures.find(row => row.evidence.canonicalUrl === source.url &&
      (row.evidence.sourceDocument?.contentHash ?? row.evidence.contentHash) === `sha256-${source.hash}` && row.evidence.retrievedAt === source.retrievedAt);
    if (!capture || !captureIntact(capture)) throw new Error("Finance bytes have no complete saved source capture.");
    const page = section3Page({ url: source.url, text: capture.evidence.text, retrievedAt: source.retrievedAt,
      linkingPage: linkingPageFrom(source.url, input.captures.filter(captureIntact).map(row => row.evidence)) }, "CAMPAIGN_FINANCE_FILING", input.now);
    if (!page.ok) throw new Error(page.reason ?? "Finance source is not verified.");
    return capture;
  });
  const bound = bindFinanceDoorFilings({ read, ballots: input.ballots,
    agency: typeof input.door.config.agency === "string" ? input.door.config.agency : used[0].evidence.sourceId });
  const records: CampaignFinanceRecord[] = bound.bound.map(({ filing, record }) => ({
    id: filing.id, ocdId: filing.ocdId, sourceUrl: filing.sourceUrl, sourceHash: filing.sourceHash,
    collectedAt: filing.retrievedAt, reportId: filing.reportId,
    record: { ...record, provenance: { ...record.provenance, verifiedAt: input.now } },
  }));
  if (!records.length) throw new Error("No filed candidate/office/cycle/jurisdiction identity is verified; unmatched rows remain owed work.");
  for (const row of records) { const issue = campaignFinanceRecordIssue(row); if (issue) throw new Error(issue); }
  const receiptCaptures = [...used, ...input.captures.filter(row => !used.includes(row) && captureIntact(row) &&
    used.some(source => linkingPageFrom(source.evidence.canonicalUrl, [row.evidence])))];
  return { unbound: bound.unbound, package: {
    contractId: "campaign-finance", version: `${input.door.doorId}:${input.now}`, sourceThrough: input.now,
    sourceReceipt: section3SourceReceipt(receiptCaptures, input.now, "Finance door field-map reader",
      "Code replayed complete saved filing bytes and matched filed candidate name, office, cycle and exact jurisdiction to one held ballot candidacy; periods stay separate."),
    payload: { kind: "campaign-finance", records },
  } satisfies ManualProjectionPackage };
}

export async function publishCampaignFinance(store: RoutineDataStore, input: Parameters<typeof campaignFinancePackage>[0]) {
  const built = campaignFinancePackage(input);
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(built.package, store, input.now);
  const published = await processRegisteredManualCandidate(store, "campaign-finance", candidate, input.now, expectedBaseVersionId);
  return { ...published, unbound: built.unbound };
}
