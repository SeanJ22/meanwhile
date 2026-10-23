import { meetingPartitionForRow } from "../../civic-data/meeting-partitions.ts";
import type { LegacyCivicExtractionContract } from "./types.ts";

/** Existing source/body identity used by the independently tested Legistar procedure. */
export const PIMA_LEGISTAR_CONTRACT: LegacyCivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1,
  subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate", "EventTime"],
  completenessScope: "Every event in this captured representation; no all-future-meetings claim.",
  expectedSourceDate: null,
};

const REGISTERED_HELD_MEETING_CONTRACTS: readonly LegacyCivicExtractionContract[] = [PIMA_LEGISTAR_CONTRACT];
const eventsAddress = (contract: LegacyCivicExtractionContract): string => `https://webapi.legistar.com/v1/${contract.publisherSlug}/events`;

/** Every address registeredHeldMeetingContract accepts starts with one of these (case aside), so a store can narrow by them first. */
export const HELD_EVENT_URL_PREFIXES: readonly string[] = REGISTERED_HELD_MEETING_CONTRACTS.map(eventsAddress);

export function registeredHeldMeetingContract(canonicalUrl: string, subjectId?: string): LegacyCivicExtractionContract | null {
  let url: URL;
  try { url = new URL(canonicalUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const address = `https://${url.hostname}${url.pathname}`.toLowerCase();
  const contract = REGISTERED_HELD_MEETING_CONTRACTS.find(row => eventsAddress(row) === address);
  if (!contract || (subjectId && subjectId !== contract.subjectId)) return null;
  const partition = meetingPartitionForRow("legistar", contract.subjectId);
  return partition.wiring?.config.slug === contract.publisherSlug ? contract : null;
}
