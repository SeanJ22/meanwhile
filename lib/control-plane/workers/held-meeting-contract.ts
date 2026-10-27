import { meetingPartitionForRow } from "../../civic-data/meeting-partitions.ts";
import { databaseByteContract } from "../../civic-data/database-byte-contract.ts";
import type { LegacyCivicExtractionContract } from "./types.ts";

/** Existing source/body identity used by the independently tested Legistar procedure. */
export const PIMA_LEGISTAR_CONTRACT = {
  ...databaseByteContract({id:"pima-legistar",recordClass:"MEETING"}),
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1,
  subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate", "EventTime"],
  completenessScope: "Every event in this captured representation; no all-future-meetings claim.",
  expectedSourceDate: null,
} satisfies LegacyCivicExtractionContract;

export function registeredHeldMeetingContract(canonicalUrl: string, subjectId?: string): LegacyCivicExtractionContract | null {
  let url: URL;
  try { url = new URL(canonicalUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "webapi.legistar.com" ||
      url.pathname.toLowerCase() !== "/v1/pima/events") return null;
  const contract = PIMA_LEGISTAR_CONTRACT;
  if (subjectId && subjectId !== contract.subjectId) return null;
  const partition = meetingPartitionForRow("legistar", contract.subjectId);
  return partition.wiring?.config.slug === contract.publisherSlug ? contract : null;
}
