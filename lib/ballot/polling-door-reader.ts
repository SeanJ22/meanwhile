import { createHash } from "node:crypto";
import type { DoorRecord } from "../doors/registry.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { parseGeneralizedRecords } from "../control-plane/workers/generalized-parser.ts";
import type { GeneralizedCivicExtractionContract, RecordExtractionShape } from "../control-plane/workers/types.ts";
import { captureIntact } from "../civic-data/worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../civic-data/source-authority.ts";
import type { VotingJurisdiction, VotingSite, VotingModel, SiteKind } from "./voting-sites.ts";

export const POLLING_DOOR_KINDS = ["polling-places-csv", "polling-places-json", "polling-places-html", "polling-places-pdf-text"] as const;
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
const words = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function model(value: unknown): VotingModel {
  const text = words(string(value)).replaceAll("_", " ");
  if (["vote center", "vote centers"].includes(text)) return "VOTE_CENTER";
  if (["assigned", "assigned site", "assigned sites"].includes(text)) return "ASSIGNED";
  throw new Error("The source does not state a readable voting model.");
}
function kind(value: unknown): SiteKind {
  const text = words(string(value)).replaceAll("_", " ");
  if (text === "election day") return "ELECTION_DAY";
  if (text === "early voting") return "EARLY_VOTING";
  if (text === "mobile") return "MOBILE";
  throw new Error("The source does not state a readable site kind.");
}
function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < -limit || number > limit) throw new Error("A published voting-site coordinate is invalid.");
  return number;
}

/** Read saved official source rows; no source list, network call or geocoding. */
export function readPollingDoor(input: {
  readonly door: DoorRecord;
  readonly capture: WorkerPublicationCapture;
  /** Exact registered label of door.ocdId; the source must name that jurisdiction. */
  readonly jurisdictionName: string;
  readonly linkingPage?: OfficialLinkingPage;
}): VotingJurisdiction {
  const { door, capture } = input, evidence = capture.evidence;
  const identity = jurisdictionFromOcdId(door.ocdId);
  if (!(POLLING_DOOR_KINDS as readonly string[]).includes(door.kind) || !door.ocdId || !identity) throw new Error("The polling door lacks its kind or exact jurisdiction.");
  const url = new URL(evidence.canonicalUrl);
  if (url.protocol !== "https:" || url.username || url.password || !door.hosts.includes(url.hostname.toLowerCase()) ||
      !isOfficialSource(evidence.canonicalUrl, input.linkingPage)) throw new Error("The polling capture is outside its official source authority.");
  if (!captureIntact(capture) || !Number.isFinite(Date.parse(capture.observedAt))) throw new Error("The polling capture is incomplete or unreadable.");
  if (!input.jurisdictionName.trim() || !evidence.sourceId.trim() || typeof door.config.extraction !== "string") throw new Error("The polling door lacks its source mapping or registered name.");
  const extraction = JSON.parse(door.config.extraction) as RecordExtractionShape;
  const expected = door.kind === "polling-places-csv" ? ["DELIMITED_TEXT"] : door.kind === "polling-places-json" ? ["JSON_RECORDS"]
    : door.kind === "polling-places-html" ? ["HTML_TABLE"] : ["TEXT_BLOCKS", "DELIMITED_TEXT", "HTML_TABLE"];
  if (!extraction || !expected.includes(extraction.format) || !extraction.fields) throw new Error("The polling mapping does not match the door kind.");
  if (door.kind === "polling-places-pdf-text" && (!evidence.sourceDocument ||
      !/^sha256-[a-f0-9]{64}$/.test(evidence.sourceDocument.contentHash))) throw new Error("The PDF text lacks its raw document identity.");
  const inventory = inventoryRecordEvidence(evidence, extraction);
  const optionalKeys = ["election", "serves"].filter(field => inventory.rows.length > 0 &&
    inventory.rows.every(row => string(row[field]?.value).length > 0));
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "VOTING_SITE", subjectId: door.ocdId,
    jurisdiction: { country: "US", state: identity.usps, canonicalId: door.ocdId },
    identity: { namespace: door.doorId, keyFields: ["name", "address", "kind", ...optionalKeys] },
    sourceScope: { sourceId: evidence.sourceId, publisher: evidence.sourceId, routeIds: [evidence.methodRouteId],
      canonicalUrls: [evidence.canonicalUrl], observationArtifactIds: [evidence.artifactId] },
    methodVersion: 1, requiredFields: ["jurisdictionName", "model", "name", "address", "kind"],
    completenessScope: "All site rows in this saved official response, without claiming all sites ever published.",
    expectedSourceDate: null, extraction, verification: { required: false, authorities: [] } };
  const parsed = parseGeneralizedRecords({ attemptId: `polling-door:${door.doorId}`, contract, evidence,
    worker: { role: "PARSER", instance: door.doorId, provider: "deterministic", version: "1" } }, contract);
  if (parsed.verdict !== "EXTRACTED" || parsed.actualRowCount !== parsed.sourceRowCount) throw new Error("The polling source rows are empty, incomplete or ambiguous.");
  const models = new Set<VotingModel>();
  const sites: VotingSite[] = parsed.records.map(row => {
    const value = row.fields;
    if (words(string(value.jurisdictionName)) !== words(input.jurisdictionName)) throw new Error("A polling source row belongs to another jurisdiction.");
    models.add(model(value.model));
    const lat = coordinate(value.lat, 90), lng = coordinate(value.lng, 180);
    if ((lat === null) !== (lng === null)) throw new Error("A voting site carries only half a point.");
    return { id: `voting-site:${digest(`${door.doorId}\n${row.id}`)}`, name: string(value.name), address: string(value.address),
      room: string(value.room) || null, lat, lng, kind: kind(value.kind),
      election: string(value.election) || null, serves: string(value.serves) || null };
  });
  if (models.size !== 1 || new Set(sites.map(site => site.id)).size !== sites.length) throw new Error("The source repeats a site or contradicts its voting model.");
  const elections = new Set(sites.map(site => site.election));
  return { ocdId: door.ocdId, name: input.jurisdictionName, state: identity.usps, model: [...models][0],
    election: elections.size === 1 ? [...elections][0] : null, sites,
    sourceOrg: evidence.sourceId, sourceUrl: evidence.canonicalUrl, collectedAt: capture.observedAt.slice(0, 10), refusal: null,
    ...(input.linkingPage ? { sourceLinkingPage: input.linkingPage } : {}),
    ...(evidence.sourceDocument ? { sourceRawSha256: evidence.sourceDocument.contentHash.slice(7) } : {}) };
}
