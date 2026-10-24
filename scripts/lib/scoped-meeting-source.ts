import type { MeetingPartitionContract } from "../../lib/civic-data/meeting-partitions.ts";
import { STANDING_PARTITION_ACQUISITION_TIMEOUT_MS } from "../../lib/sources/composite/wiring.ts";
import { CompositeSource } from "../../lib/sources/composite/index.ts";
import { legistarClientsFromWiring } from "../../lib/sources/legistar/client-registry.ts";
import { makeLegistarSource, normalizeWithDrops, type LegistarEventWithClient } from "../../lib/sources/legistar/index.ts";
import { makeLegistarInSiteSource } from "../../lib/sources/legistar-insite/index.ts";
import { inSiteTenantsFromWiring } from "../../lib/sources/legistar-insite/tenant-registry.ts";
import type { ReportingMeetingSource } from "../../lib/sources/types.ts";

/** Acquire only the exact body bound by this official calendar door. */
export function scopedMeetingSource(partition: MeetingPartitionContract): CompositeSource | null {
  if (!partition.wiring || partition.derivedFamily !== null) return null;
  const options = { timeoutMs: STANDING_PARTITION_ACQUISITION_TIMEOUT_MS, captureAcquisitionEvidence: true };
  if (partition.meetingSource === "legistar") {
    const clients = legistarClientsFromWiring([partition.wiring]);
    const child: ReportingMeetingSource<LegistarEventWithClient> = {
      ...makeLegistarSource(clients),
      normalizeWithDrops: (raw, now) => normalizeWithDrops(raw, now ?? new Date(), clients),
    };
    return new CompositeSource([child as ReportingMeetingSource<unknown>], options);
  }
  if (partition.meetingSource === "legistar-insite") {
    const tenants = inSiteTenantsFromWiring([partition.wiring]);
    return new CompositeSource([makeLegistarInSiteSource({ tenants }) as ReportingMeetingSource<unknown>], options);
  }
  return null;
}
