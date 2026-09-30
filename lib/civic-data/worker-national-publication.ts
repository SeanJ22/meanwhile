/**
 * The national place publisher (S4 for S9's place-first hunts). A place with
 * no hand-prepared registry — Columbus, Ohio, say — becomes readable in two
 * ordinary registry-door publications:
 *
 * 1. Its Census divisions, each checked against the saved Census response it
 *    came from (§3: official, fresh, the value on the page), and the bodies
 *    those divisions imply (`bodiesFor`: a municipality's council, a county's
 *    governing board, a school board; none for a statistical or fictitious
 *    Census row). A legislative district gets one seat body, named by its
 *    Census label, because the chamber sits elsewhere.
 * 2. Each official whose name and seat are on their own saved official page,
 *    inside its freshness window, as a partial roster reading of that body.
 *    A one-person profile is never a complete roster, so no one departs.
 *
 * Anything that does not pass stays a gap with its reason; nothing is invented
 * and no state is registered by hand.
 */
import type { RoutineDataStore } from "./store.ts";
import type { OfficialLinkingPage } from "./source-authority.ts";
import type { Body, Division, SourceDataset } from "../registry/types.ts";
import type { Tier } from "../ocd/tiers.ts";
import { bodiesFor } from "../registry/derive.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, type RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { captureIntact, section3SourceReceipt } from "./worker-publication-evidence.ts";
import { publishRosterReading, type RosterReading, type WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { section3Page, valueOnPage } from "../control-plane/promotion/section3.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { createHash } from "node:crypto";

/** One Census division as the place hunt resolved it. `sourceUrl` is the saved Census response it came from. */
export interface NationalDivisionInput {
  readonly id: string;
  readonly label: string;
  readonly divisionType: string;
  readonly geoid: string | null;
  readonly sourceUrl: string;
  /** Which Census product the response is, stated by the caller that read it. */
  readonly sourceDataset: SourceDataset;
  readonly lsad?: string | null;
  readonly funcstat?: string | null;
  readonly classfp?: string | null;
}

/** One official found for a division, with the saved official page that names them. */
export interface NationalOfficialInput {
  readonly discoveryId: string;
  readonly divisionId: string;
  readonly name: string;
  /** The seat as the official page writes it ("Representative", "Council Member"). */
  readonly officeTitle: string;
  readonly officialUrl: string;
  readonly document: { readonly url: string; readonly capture?: WorkerPublicationCapture };
  readonly linkingPage?: OfficialLinkingPage | null;
}

export interface NationalPlacePublicationInput {
  readonly store: RoutineDataStore;
  readonly now: string;
  readonly divisions: readonly NationalDivisionInput[];
  readonly geographyCaptures: readonly WorkerPublicationCapture[];
  readonly sources: { readonly officials: readonly NationalOfficialInput[] };
}

export interface NationalPlacePublication {
  /** The last candidate and promoted version this call produced (null when nothing new was published). */
  readonly candidateId: string | null;
  readonly promotedVersionId: string | null;
  readonly divisions: readonly string[];
  readonly bodies: readonly string[];
  /** Reader member ids of officials now live, by body. */
  readonly members: readonly { readonly bodyId: string; readonly versionId: string; readonly discoveryIds: readonly string[] }[];
  readonly gaps: readonly { readonly key: string; readonly detail: string }[];
}

const DIVISION_TYPES: Readonly<Record<string, Division["divisionType"]>> = {
  place: "place", county: "county", school: "school_district", school_district: "school_district", cd: "cd", sldu: "sldu", sldl: "sldl",
};
const TIERS: Readonly<Record<Division["divisionType"], Tier>> = { cd: "national", sldu: "state", sldl: "state", county: "local", place: "local", school_district: "local" };
const LEGISLATIVE = new Set<Division["divisionType"]>(["cd", "sldu", "sldl"]);

/** The body an official of this division sits on. */
export function nationalBodyId(division: Pick<Division, "ocdId" | "divisionType">): string {
  if (LEGISLATIVE.has(division.divisionType)) return `${division.ocdId}#seat`;
  return `${division.ocdId}#${division.divisionType === "school_district" ? "board" : "governing"}`;
}

/** The registry row for a division, when its saved Census response supports it (§3). */
function divisionRow(input: NationalDivisionInput, captures: readonly WorkerPublicationCapture[], now: string): Division | string {
  const divisionType = DIVISION_TYPES[input.divisionType];
  if (!divisionType) return `DIVISION_TYPE_NOT_A_REGISTRY_DIVISION:${input.divisionType}`;
  const state = /\/state:([a-z]{2})\b/.exec(input.id)?.[1]?.toUpperCase();
  if (!state) return "DIVISION_STATE_UNRESOLVED";
  const capture = captures.find(c => c.evidence.canonicalUrl === input.sourceUrl);
  if (!capture || !captureIntact(capture)) return `DIVISION_SOURCE_NOT_SAVED:${input.sourceUrl}`;
  const verdict = section3Page({ url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt }, "CENSUS_GEOGRAPHY", now);
  if (!verdict.ok) return verdict.reason!;
  if (!valueOnPage(input.label, capture.evidence.text) || (input.geoid !== null && !capture.evidence.text.includes(input.geoid))) return "DIVISION_NOT_ON_SAVED_SOURCE";
  return { ocdId: input.id, divisionType, tier: TIERS[divisionType], state, label: input.label, parentOcdId: input.id.replace(/\/[^/]+$/, ""),
    lsad: input.lsad ?? null, funcstat: input.funcstat ?? null, classfp: input.classfp ?? null, geoid: input.geoid,
    canonicalOcdId: input.id, canonicalMatch: "exact", sourceDataset: input.sourceDataset,
    provenance: { sourceUrl: input.sourceUrl, sourceOrg: "U.S. Census Bureau", collectedAt: capture.observedAt, verifiedAt: now } } as Division;
}

/** A legislative district's seat: one body per district, named by its Census label, so its holder has a place on the reader. */
function seatBody(division: Division, now: string): Body {
  return { id: nationalBodyId(division), ocdId: division.ocdId, name: division.label, bodyClass: "GOVERNING", bodyOrigin: "DERIVED_FROM_DIVISION_TYPE",
    coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE", agendaSourceRef: null, meetingCadence: null, homepageUrl: null, demandCount: 0,
    sourceDataset: "DERIVED", provenance: { sourceUrl: division.provenance.sourceUrl, sourceOrg: division.provenance.sourceOrg, collectedAt: now, verifiedAt: null } };
}

async function promote(store: RoutineDataStore, prepared: Parameters<typeof registryRuntimeCandidate>[0], prior: NonNullable<Awaited<ReturnType<typeof readRegistryRuntimePrior>>>, now: string) {
  const candidate = registryRuntimeCandidate(prepared, { prior });
  const published = await processRegisteredManualCandidate(store, "registry-runtime-bindings", candidate, now, prior.versionId);
  if (!published.promoted) throw new Error(`NATIONAL_REGISTRY_GATE_HELD:${published.candidate.failureCode ?? ""}:${published.candidate.failureDetail ?? published.candidate.state}`);
  const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(store,
    requiredManualProductionContract("registry-runtime-bindings"), published.promoted, now);
  if (readback?.status !== "PASS") throw new Error(`NATIONAL_REGISTRY_READBACK_FAILED:${readback?.detail ?? "missing typed reader receipt"}`);
  return { candidateId: candidate.id, versionId: published.promoted.versionId, readModel: candidate.readModel as RegistryRuntimeReadModel };
}

/**
 * Publish a place's Census divisions, their bodies and its verified officials
 * through the ordinary registry door. Idempotent: a second call with the same
 * saved evidence confirms rather than duplicates.
 */
export async function publishNationalPlaceSources(input: NationalPlacePublicationInput): Promise<NationalPlacePublication> {
  const gaps: { key: string; detail: string }[] = [];
  let prior = await readRegistryRuntimePrior(input.store, input.now);
  if (!prior) throw new Error("NATIONAL_REGISTRY_PRIOR_MISSING");
  let candidateId: string | null = null, promotedVersionId: string | null = null;

  // 1. Divisions and the bodies they imply.
  const heldDivisions = new Map(prior.payload.registry.divisions.map(d => [d.ocdId, d]));
  const heldBodies = new Set(prior.payload.registry.bodies.map(b => b.id));
  const divisions: Division[] = [], bodies: Body[] = [], used = new Set<string>();
  const officialDivisions = new Set(input.sources.officials.map(o => o.divisionId));
  for (const row of input.divisions) {
    const division = heldDivisions.get(row.id) ?? divisionRow(row, input.geographyCaptures, input.now);
    if (typeof division === "string") { gaps.push({ key: `division:${row.id}`, detail: division }); continue; }
    if (!heldDivisions.has(row.id)) { divisions.push(division); used.add(row.sourceUrl); }
    const implied = LEGISLATIVE.has(division.divisionType)
      ? officialDivisions.has(division.ocdId) ? [seatBody(division, input.now)] : []
      : bodiesFor(division, input.now);
    for (const body of implied) {
      if (heldBodies.has(body.id)) continue;
      bodies.push({ ...body, provenance: { ...body.provenance, sourceUrl: division.provenance.sourceUrl } });
      used.add(division.provenance.sourceUrl ?? "");
    }
  }
  if (divisions.length || bodies.length) {
    const captures = input.geographyCaptures.filter(c => used.has(c.evidence.canonicalUrl));
    const sourceReceipt = section3SourceReceipt(captures, input.now, "section3-validator:national-place",
      `${divisions.length} Census division(s) found on their saved Census responses inside the freshness window (§3); ${bodies.length} implied body row(s).`);
    const digest = createHash("sha256").update(canonicalJson({ divisions, bodies: bodies.map(b => b.id) })).digest("hex").slice(0, 16);
    const published = await promote(input.store, { contractId: "registry-runtime-bindings", version: `national-place:${digest}`, sourceThrough: input.now, sourceReceipt,
      payload: { ...prior.payload, registry: { ...prior.payload.registry, divisions, bodies },
        bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
        officialCandidacies: { ...prior.payload.officialCandidacies, rows: [] } } }, prior, input.now);
    ({ candidateId } = published); promotedVersionId = published.versionId;
    prior = (await readRegistryRuntimePrior(input.store, input.now))!;
  }

  // 2. Officials, one partial roster reading per body.
  const byBody = new Map<string, NationalOfficialInput[]>();
  const registered = new Map(prior.payload.registry.divisions.map(d => [d.ocdId, d]));
  for (const official of input.sources.officials) {
    const division = registered.get(official.divisionId);
    const capture = official.document.capture;
    if (!division) { gaps.push({ key: `official:${official.discoveryId}`, detail: "OFFICIAL_DIVISION_NOT_REGISTERED" }); continue; }
    if (!capture || !captureIntact(capture)) { gaps.push({ key: `official:${official.discoveryId}`, detail: `OFFICIAL_PAGE_NOT_SAVED:${official.document.url}` }); continue; }
    const bodyId = nationalBodyId(division);
    if (!prior.payload.registry.bodies.some(b => b.id === bodyId)) { gaps.push({ key: `official:${official.discoveryId}`, detail: `OFFICIAL_BODY_NOT_REGISTERED:${bodyId}` }); continue; }
    byBody.set(bodyId, [...(byBody.get(bodyId) ?? []), official]);
  }
  const members: { bodyId: string; versionId: string; discoveryIds: string[] }[] = [];
  for (const [bodyId, officials] of byBody) {
    // One saved page per reading: the §3 check reads each official's own page.
    for (const official of officials) {
      const capture = official.document.capture!;
      const reading: RosterReading = { id: `national:${official.discoveryId}`, capture, linkingPage: official.linkingPage ?? null, complete: false,
        method: "Place-first national lead; official profile page read",
        members: [{ recordId: `national:${official.discoveryId}`, fields: { name: official.name, office: official.officeTitle, websiteUrl: official.officialUrl } }] };
      try {
        const published = await publishRosterReading({ store: input.store, bodyId, reading, now: input.now });
        if (!published.confirmed) promotedVersionId = published.versionId;
        members.push({ bodyId, versionId: published.versionId, discoveryIds: [official.discoveryId] });
      } catch (error) {
        gaps.push({ key: `official:${official.discoveryId}`, detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { candidateId, promotedVersionId, divisions: divisions.map(d => d.ocdId), bodies: bodies.map(b => b.id), members, gaps };
}
