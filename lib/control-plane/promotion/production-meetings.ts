import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import { collectFactChains, readFactItemStates, type FactChainCollection, type FactChainOptions } from "./fact-chain.ts";
import type { PipelineItemState } from "./types.ts";
import type { MeetingPartitionContract } from "../../civic-data/meeting-partitions.ts";
import { snapshotCounts, validateSnapshot, type MeetingsSnapshot } from "../../meetings/snapshot.ts";
import type { Artifact } from "../evidence/artifact.ts";
import { PERMISSION_STATES } from "../../workstate/types.ts";

export const RESEARCH_MEETING_ACTIVATION = "VERIFIED_RESEARCH_TO_REGISTERED_MEETING_PARTITION/1";

export interface ApprovedResearchMeetingPartition {
  readonly snapshot: MeetingsSnapshot;
  /** This witness travels in the production candidate's dependent checks. */
  readonly activationReceipt: {
    readonly kind: typeof RESEARCH_MEETING_ACTIVATION;
    readonly partitionId: string;
    readonly artifactId: string;
    readonly approvalRecordIds: readonly string[];
    readonly parserResultId: string;
    readonly validatorResultId: string;
    readonly auditorResultId: string;
    readonly evidenceScope: "CURRENT_CAPTURE_MEETING_FACTS";
    readonly coveredMeetingIds: readonly string[];
    readonly approvedFactCount: number;
  };
}

/** A full approved capture, never a partial fact list replacing a source partition. */
export function approvedResearchMeetingPartition(input: {
  readonly partition: MeetingPartitionContract;
  readonly collection: FactChainCollection;
  readonly states: readonly PipelineItemState[];
  readonly now: string;
  readonly previous: MeetingsSnapshot | null;
  readonly acquisitionByArtifact: ReadonlyMap<string, Artifact>;
}): ApprovedResearchMeetingPartition | null {
  const { partition, collection, now, previous } = input;
  const states = new Map(input.states.map(state => [state.itemId, state]));
  const chains = [...collection.chains].sort((a, b) => b.artifact.recordedAt.localeCompare(a.artifact.recordedAt));
  for (const chain of chains) {
    const source = chain.bridge.source;
    const acquisition = input.acquisitionByArtifact.get(chain.artifact.artifactId);
    // Any recorded robots.txt verdict is admissible (a record, never a gate: owner decision 2026-09-25); a walled,
    // unreached or non-2xx capture never is.
    if (!acquisition || acquisition.contentHash !== chain.artifact.contentHash ||
        acquisition.canonicalUrl !== chain.artifact.canonicalUrl || acquisition.byteLength !== chain.artifact.byteLength ||
        !(PERMISSION_STATES as readonly string[]).includes(acquisition.permission) || acquisition.transport !== "REACHABLE" ||
        acquisition.httpStatus === null || acquisition.httpStatus < 200 || acquisition.httpStatus >= 300) continue;
    if (!source || source.sourceId !== partition.meetingSource || source.body?.bodyId !== partition.bodyId ||
        !source.meetings.length || !chain.validator || !chain.auditor ||
        chain.validator.result.verdict !== "PASS" || chain.auditor.result.verdict !== "SURVIVED") continue;
    // An exact-byte routine re-observation can keep an immutable first capture
    // current. A different newer response can never be replaced by old research.
    const reobserved = previous?.sources.some(report => report.source === source.sourceId && report.ok &&
      report.acquisitions?.some(evidence => evidence.rawHash === chain.artifact.contentHash.replace(/^sha256-/, "") &&
        evidence.byteCount === chain.artifact.byteLength && evidence.finalUrl === acquisition.canonicalUrl));
    if (previous && chain.artifact.recordedAt <= previous.generatedAt && !reobserved) continue;
    const observedAt = reobserved && previous!.generatedAt > chain.artifact.recordedAt ? previous!.generatedAt : chain.artifact.recordedAt;
    const at = Date.parse(observedAt);
    const age = Date.parse(now) - at;
    if (!Number.isFinite(age) || age < 0 || age > 24 * 3_600_000) continue;
    const items = collection.items.filter(item => item.chain === chain);
    const meetingItems = items.filter(item => item.fact.recordClass === "meeting-times");
    if (meetingItems.length !== source.meetings.length ||
        new Set(meetingItems.map(item => item.fact.meetingId)).size !== source.meetings.length) continue;
    if (source.meetings.some(meeting => !meetingItems.some(item =>
      item.fact.meetingId === meeting.id && canonicalJson(item.fact.meeting) === canonicalJson(meeting)))) continue;
    const approvals = items.map(item => {
      const state = states.get(item.itemId);
      const approval = state?.byStage.APPROVED_FOR_PROMOTION;
      return state?.stage === "APPROVED_FOR_PROMOTION" && approval &&
        approval.burdens?.every(burden => burden.result === "PASS") &&
        state.byStage.VERIFIED?.workerResultId === chain.validator!.id &&
        state.byStage.AUDITED?.workerResultId === chain.auditor!.id ? approval.recordId : null;
    });
    if (!items.length || approvals.some(approval => approval === null)) continue;
    // A later contradictory source observation invalidates an old approval.
    if (items.some(item => item.newerSameSource && canonicalJson(item.newerSameSource.meetings) !== canonicalJson(source.meetings))) continue;
    const snapshot: MeetingsSnapshot = {
      formatVersion: 1, generatedAt: observedAt,
      counts: snapshotCounts(source.meetings, 0), meetings: [...source.meetings], agendaDocuments: [],
      sources: [{ source: source.sourceId, ok: true, error: null,
        fetched: source.considered, normalized: source.meetings.length,
        drops: source.drops ?? { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        acquisitions: [{ source: source.sourceId, requestedUrl: acquisition.retrievalUrl,
          finalUrl: acquisition.canonicalUrl, httpStatus: acquisition.httpStatus, byteCount: chain.artifact.byteLength,
          rawHash: chain.artifact.contentHash.replace(/^sha256-/, "") }] }],
    };
    validateSnapshot(snapshot);
    return { snapshot, activationReceipt: { kind: RESEARCH_MEETING_ACTIVATION, partitionId: partition.id,
      artifactId: chain.artifact.artifactId, approvalRecordIds: approvals as string[],
      evidenceScope: "CURRENT_CAPTURE_MEETING_FACTS", coveredMeetingIds: source.meetings.map(meeting => meeting.id), approvedFactCount: approvals.length,
      parserResultId: chain.parser.id, validatorResultId: chain.validator.id, auditorResultId: chain.auditor.id } };
  }
  return null;
}

/** Read-only intake. The registered routine child retains the sole production write. */
export async function readApprovedResearchMeetingPartition(
  repos: ControlPlaneRepositories, partition: MeetingPartitionContract,
  options: FactChainOptions & { readonly readAcquisition: (artifactId: string) => Promise<Artifact> }, previous: MeetingsSnapshot | null,
): Promise<ApprovedResearchMeetingPartition | null> {
  if (!["legistar", "civicclerk"].includes(partition.meetingSource)) return null;
  const states = await readFactItemStates(repos);
  if (!states.some(state => state.stage === "APPROVED_FOR_PROMOTION" && state.byStage.SCOUTED?.subjectId === partition.bodyId)) return null;
  const collection = await collectFactChains(repos, options);
  const acquisitionByArtifact = new Map<string, Artifact>();
  for (const chain of collection.chains) {
    if (chain.bridge.source?.body?.bodyId !== partition.bodyId) continue;
    acquisitionByArtifact.set(chain.artifact.artifactId, await options.readAcquisition(chain.artifact.artifactId));
  }
  return approvedResearchMeetingPartition({ partition, collection, states, previous, now: options.now, acquisitionByArtifact });
}
