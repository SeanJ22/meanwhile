import {
  SOURCE_WIRING,
  meetingSourceNamesForWiring,
  type BodySourceWiring,
} from "../registry/source-wiring.ts";
import {
  MEETING_PARTITION_POLICY,
  ROUTINE_SOURCE_CONTRACTS,
  type RoutineSourceContract,
} from "./contracts.ts";

export const LEGACY_MEETINGS_AGGREGATE_SCOPE = "supported-bodies";

export interface MeetingPartitionContract extends RoutineSourceContract {
  readonly meetingSource: string;
  /** Shared network/upstream boundary used to keep one outage to one lane. */
  readonly acquisitionFailureDomain: string;
  readonly bodyId: string;
  readonly ocdId: string | null;
  readonly wiring: BodySourceWiring;
}

export function meetingPartitionScope(sourceName: string, bodyId: string): string {
  if (!sourceName || !bodyId) throw new Error("MEETING_PARTITION_IDENTITY_MISSING");
  return `source:${encodeURIComponent(sourceName)}:body:${encodeURIComponent(bodyId)}`;
}

export function meetingPartitionId(sourceName: string, bodyId: string): string {
  return `meetings:${sourceName}:${encodeURIComponent(bodyId)}`;
}

/**
 * Identify the actual upstream host a partition contacts. Adapter names are
 * too broad (`ical` spans unrelated publishers), while body ids are too narrow
 * (many bodies intentionally share one feed). A host outage therefore gets
 * one bounded lane without serializing unrelated publishers on other hosts.
 * Every supported adapter is explicit so a new route cannot silently fall
 * back to the old all-meetings failure domain.
 */
export function meetingAcquisitionFailureDomain(
  sourceName: string,
  wiring: BodySourceWiring,
): string {
  const endpoint = (() => {
    switch (sourceName) {
      case "legistar": return "https://webapi.legistar.com";
      case "legistar-insite": return wiring.config.insiteHost;
      case "onbase": return wiring.config.baseUrl;
      case "diligent": return wiring.config.serviceBase;
      case "clerksboards": return "https://clerksboards.tucsonaz.gov";
      case "boardbook": return "https://meetings.boardbook.org";
      case "civicplus": return wiring.config.icalUrl;
      case "iqm2": return wiring.config.base;
      case "revize": return wiring.config.base;
      case "apptegy": return wiring.config.apiBase;
      case "schedulepage": return wiring.config.schedulePage;
      case "ical": return wiring.config.feedUrl;
      case "civicclerk": return wiring.config.apiBase;
      default: throw new Error(`MEETING_FAILURE_DOMAIN_ADAPTER_UNKNOWN:${sourceName}`);
    }
  })()?.trim();
  if (!endpoint) {
    throw new Error(`MEETING_FAILURE_DOMAIN_ENDPOINT_MISSING:${sourceName}:${wiring.bodyId}`);
  }
  let url: URL;
  try {
    url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
  } catch {
    throw new Error(`MEETING_FAILURE_DOMAIN_ENDPOINT_INVALID:${sourceName}:${wiring.bodyId}`);
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error(`MEETING_FAILURE_DOMAIN_ENDPOINT_INVALID:${sourceName}:${wiring.bodyId}`);
  }
  return `meeting-upstream:${url.hostname.toLowerCase()}`;
}

function buildMeetingPartitions(): readonly MeetingPartitionContract[] {
  const { readerConsumers, ...policy } = MEETING_PARTITION_POLICY;
  const partitions = SOURCE_WIRING.flatMap((wiring) =>
    meetingSourceNamesForWiring(wiring).map((meetingSource) => ({
      ...policy,
      id: meetingPartitionId(meetingSource, wiring.bodyId),
      scope: meetingPartitionScope(meetingSource, wiring.bodyId),
      acquisitionAdapter: {
        authorityMode: "REGISTERED_SOURCE_ROUTES" as const,
        command: ["scripts/ingest.ts", "composite", "--promote", `--only-partition=${meetingPartitionId(meetingSource, wiring.bodyId)}`],
      },
      readerProjection: {
        id: `meetings-partition:${meetingSource}:${wiring.bodyId}`,
        consumers: readerConsumers,
      },
      lkgBehavior:
        `Only ${meetingSource}/${wiring.bodyId} may move this pointer. A refusal leaves this partition's prior GOOD version live without delaying any other source/body.`,
      bootstrapFixturePaths: [],
      meetingSource,
      acquisitionFailureDomain: meetingAcquisitionFailureDomain(meetingSource, wiring),
      bodyId: wiring.bodyId,
      ocdId: wiring.ocdId,
      wiring,
    })),
  );
  const ids = new Set<string>();
  const scopes = new Set<string>();
  for (const partition of partitions) {
    if (ids.has(partition.id) || scopes.has(partition.scope)) {
      throw new Error(`MEETING_PARTITION_COLLISION:${partition.id}:${partition.scope}`);
    }
    ids.add(partition.id);
    scopes.add(partition.scope);
  }
  return partitions;
}

/** One permanent contract and canonical pointer per registered route/body. */
export const MEETING_PARTITION_CONTRACTS = buildMeetingPartitions();

export function meetingPartitionContract(id: string): MeetingPartitionContract | null {
  return MEETING_PARTITION_CONTRACTS.find((partition) => partition.id === id) ?? null;
}

export function requiredMeetingPartitionContract(id: string): MeetingPartitionContract {
  const contract = meetingPartitionContract(id);
  if (!contract) throw new Error(`MEETING_PARTITION_CONTRACT_MISSING:${id}`);
  return contract;
}

export function meetingPartitionsForSource(sourceName: string): readonly MeetingPartitionContract[] {
  return MEETING_PARTITION_CONTRACTS.filter((partition) => partition.meetingSource === sourceName);
}

export function meetingPartitionForRow(sourceName: string, bodyId: string): MeetingPartitionContract {
  return requiredMeetingPartitionContract(meetingPartitionId(sourceName, bodyId));
}

/**
 * Admin and the standing runner observe actual partition authorities. There
 * is no aggregate meetings contract, pointer, task, or promotion door.
 */
export function observableRoutineContracts(): readonly RoutineSourceContract[] {
  return [
    ...ROUTINE_SOURCE_CONTRACTS,
    ...MEETING_PARTITION_CONTRACTS,
  ];
}
