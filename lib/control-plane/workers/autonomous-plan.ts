import type { CivicExtractionContract } from "./types.ts";
import type { AcquirerTaskSpec, ObservedResearchRoute } from "./research-types.ts";
import type { EngineeringTaskSpec } from "./engineering-types.ts";
import { scheduleObligation, type FreshnessObligation } from "../scheduler/obligation.ts";
import type { AcquirerResult } from "./research-types.ts";
import type { Jurisdiction, JurisdictionSource } from "../../hunt/jurisdiction-universe.ts";
import type { WorkerReaderContract } from "../../civic-data/worker-reader-contracts.ts";
import { missionPartOf } from "../expansion/mission-parts.ts";

/** The mission part a plan's record class starts in (CH-15's starting parts). Omitted when no part takes it. */
function partFor(recordClass: string): { readonly missionPart?: string } {
  const part = missionPartOf({ recordClass });
  return part ? { missionPart: part } : {};
}

/** Initial instructions for an owner-requested family. Registry addresses are
 * leads, never invented observations. An evidence-backed repair supplies the
 * extraction mapping; the Validator then applies §3 to the saved official page.
 * No second source is required: these families are not judgment calls. */
export function jurisdictionDiscoveryPlan(jurisdiction: Jurisdiction, source: JurisdictionSource, routeId: string, bodyId: string | null = jurisdiction.bodyId ?? null): AutonomousWorkPlan | null {
  if (source.recordClass === "MEETINGS") return null; // Existing meeting discovery/publishing owns this path.
  if (source.recordClass === "PUBLIC_COMMENT") return publicCommentDiscoveryPlan(jurisdiction, bodyId);
  const spec = source.recordClass === "OFFICEHOLDERS"
    ? { recordClass: "OFFICIAL_ROSTER", fields: ["name", "office"] }
    : source.recordClass === "PUBLIC_SERVICES"
      ? { recordClass: "SERVICE_CONTACT", fields: ["bodyName", "topicId", "serviceZip", "service", "serviceAreaEvidence"] }
    : source.recordClass === "VOTER_ACCESS"
      ? { recordClass: "VOTER_ACCESS_ROUTE", fields: ["bodyName", "state", "kind", "url", "coverage", "coverageEvidence"] }
    : source.recordClass === "BALLOT_AND_CANDIDATES"
      ? { recordClass: "BALLOT_CONTEST", fields: ["election", "office", "candidateName", "jurisdictionName"] }
    : source.recordClass === "BALLOT_MEASURES"
      ? { recordClass: "BALLOT_MEASURE", fields: ["election", "title", "jurisdictionName", "textUrl"] }
    : source.recordClass === "GOVERNMENT_FINANCE" || source.recordClass === "SPECIAL_DISTRICT_BOUNDARIES"
      ? { recordClass: "PUBLIC_RECORD", fields: ["bodyName", "title", "kindLabel", "sourceSentence"] }
    : source.recordClass === "POLLING_PLACES"
      ? { recordClass: "VOTING_SITE", fields: ["jurisdictionName", "model", "name", "address", "kind"] }
    : source.recordClass === "PUBLIC_RECORDS"
      ? { recordClass: "PUBLIC_RECORD", fields: ["bodyName", "title", "kindLabel", "sourceSentence"] }
    : source.recordClass === "ADOPTED_BUDGETS"
      ? { recordClass: "ADOPTED_BUDGET", fields: ["bodyName", "title", "fiscalYear", "version", "documentUrl", "sourceSentence"] }
    : source.recordClass === "BUDGET_RESPONSIBILITIES"
      ? { recordClass: "BUDGET_RESPONSIBILITY", fields: ["bodyName", "role", "responsible", "authorityKind", "sourceSentence"] }
    : source.recordClass === "BUDGET_AMENDMENTS"
      ? { recordClass: "BUDGET_AMENDMENT", fields: ["bodyName", "title", "fiscalYear", "budgetVersion", "documentUrl", "sourceSentence"] }
      : { recordClass: "CAMPAIGN_FINANCE_FILING", fields: ["bodyName", "jurisdictionName", "committeeName", "filingPeriod", "documentUrl"] };
  const seedUrls = [...new Set([source.url, jurisdiction.ownWebAddress].filter((url): url is string => {
    if (!url) return false;
    try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; }
  }))];
  return {
    version: 1, capability: source.recordClass === "OFFICEHOLDERS" ? "officials/offices" : source.recordClass, jurisdiction: jurisdiction.id.split(":")[0].toUpperCase(),
    sourceRegistryReferences: [jurisdiction.id, routeId], seedUrls, sources: [], acquisition: [], engineering: [], auditScope: "SOURCE_UNIVERSE",
    ...partFor(spec.recordClass),
    ...(source.recordClass === "OFFICEHOLDERS" && bodyId ? { publication: { contractId: "registry-runtime-bindings" as const, bodyId } } : {}),
    ...(source.recordClass === "PUBLIC_SERVICES" && bodyId ? { publication: { contractId: "everyday-routing" as const, bodyId } } : {}),
    ...(source.recordClass === "POLLING_PLACES" && bodyId ? { publication: { contractId: "voting-sites" as const, bodyId } } : {}),
    ...(source.recordClass === "VOTER_ACCESS" && bodyId ? { publication: { contractId: "ballot-navigation" as const, bodyId } } : {}),
    ...(["BALLOT_CONTEST", "BALLOT_MEASURE"].includes(spec.recordClass) && bodyId ? { publication: { contractId: "ballot-contests" as const, bodyId } } : {}),
    ...(spec.recordClass === "PUBLIC_RECORD" && bodyId ? { publication: { contractId: source.recordClass === "SPECIAL_DISTRICT_BOUNDARIES" ? "special-district-boundaries" as const : source.recordClass === "GOVERNMENT_FINANCE" ? "government-budgets" as const : "public-records" as const, bodyId } } : {}),
    ...(["ADOPTED_BUDGET", "BUDGET_RESPONSIBILITY", "BUDGET_AMENDMENT"].includes(spec.recordClass) && bodyId ? { publication: { contractId: "government-budgets" as const, bodyId } } : {}),
    ...(["CANDIDATE_FILING_DOCUMENT", "CAMPAIGN_FINANCE_FILING"].includes(spec.recordClass) && bodyId ? { publication: { contractId: "official-filings" as const, bodyId } } : {}),
    contract: {
      schemaVersion: 2, recordClass: spec.recordClass, subjectId: jurisdiction.id,
      requiredFields: spec.fields, identity: { namespace: `${jurisdiction.id}:${source.recordClass}`, keyFields: spec.fields },
      jurisdiction: { country: "US", state: jurisdiction.id.split(":")[0].toUpperCase(), canonicalId: jurisdiction.id },
      completenessScope: `${source.recordClass} for ${jurisdiction.name}. ${source.owed ?? source.authorityBasis} This initial source contract does not discharge downstream information families or establish publisher absence.`,
      // Zero means an unbound instruction template, never an extraction result.
      // The standing runtime binds its actual inherited method-store version
      // before consuming any repair or dispatching a worker.
      expectedSourceDate: null, methodVersion: 0,
      sourceScope: { sourceId: `unobserved:${routeId}`, publisher: source.authority, routeIds: [routeId], canonicalUrls: [], observationArtifactIds: [] },
      extraction: { format: "UNSUPPORTED", mediaType: "unobserved", fields: {}, reason: "Discover actual source bytes, applicability and an executable mapping." },
      verification: { required: false, authorities: [] },
    },
  };
}

/** Separate owed public-comment work: a roster or calendar cannot discharge
 * participation rules. The system binds the actual registered body identity. */
export function publicCommentDiscoveryPlan(jurisdiction: Jurisdiction, bodyId: string | null): AutonomousWorkPlan | null {
  if (!bodyId) return null; // The unresolved registry/body obligation still remains owed.
  const routeId = "coverage-discovery:public-comment";
  const base = jurisdictionDiscoveryPlan(jurisdiction, { recordClass: "OFFICEHOLDERS", authority: jurisdiction.name,
    authorityBasis: "Exact registered governing body; its participation rules have not been acquired or verified.", scope: "THIS_JURISDICTION",
    routeId, url: jurisdiction.ownWebAddress, state: "DISCOVERY_OWED", owed: "Find the body's published public-comment rules, including signup, written comments, attendance and speaking limits. Take each from the body's own official page; do not infer permission to speak from an open meeting.",
    citation: `Registered government ${jurisdiction.id}, body ${bodyId}.` }, routeId, bodyId)!;
  if (base.contract.schemaVersion !== 2) throw new Error("PUBLIC_COMMENT_TEMPLATE_INVALID");
  return { ...base, capability: "meetings/public-comment", publication: { contractId: "comment-access", bodyId }, ...partFor("PUBLIC_COMMENT_RULE"),
    sourceRegistryReferences: [...base.sourceRegistryReferences, bodyId],
    contract: { ...base.contract, recordClass: "PUBLIC_COMMENT_RULE", requiredFields: ["bodyName", "commentPeriod", "commentPeriodDetail"],
      identity: { namespace: `${jurisdiction.id}:public-comment`, keyFields: ["bodyName"] },
      completenessScope: `Published participation rules for registered body ${bodyId}. YES, NO or UNKNOWN must describe what the source actually supports. Each instruction must appear on the saved official page; this work does not discharge calendars, agendas, minutes or other bodies.` } };
}

/** A roster cannot establish which other boards exist. Keep directory discovery
 * as its own obligation, with the Census/registry join supplied by the system. */
export function bodyDirectoryDiscoveryPlan(jurisdiction: Jurisdiction, bodyId: string | null): AutonomousWorkPlan {
  const routeId = "coverage-discovery:body-directory";
  const base = jurisdictionDiscoveryPlan(jurisdiction, { recordClass: "OFFICEHOLDERS", authority: jurisdiction.name,
    authorityBasis: "Discover governing and subordinate bodies from official directory and independent legal authority.",
    scope: "THIS_JURISDICTION", routeId, url: jurisdiction.ownWebAddress, state: "DISCOVERY_OWED",
    owed: "Identify every governing and subordinate body, its official name, home page, classification and actual jurisdiction. Take territorial applicability from an official page; association with a county is not countywide authority.",
    citation: `Registered government ${jurisdiction.id}.` }, routeId, bodyId)!;
  if (base.contract.schemaVersion !== 2) throw new Error("DIRECTORY_TEMPLATE_INVALID");
  const { publication: _old, ...plan } = base;
  const divisionId = jurisdiction.ocdId ?? bodyId?.split("#")[0] ?? null;
  return { ...plan, capability: "governments/body-directory", ...partFor("OFFICIAL_BOARD_DIRECTORY"),
    directorySubject: { jurisdiction, divisionId },
    publication: { contractId: "registry-runtime-bindings", bodyId: bodyId ?? `unresolved:${jurisdiction.id}` },
    contract: { ...base.contract, recordClass: "OFFICIAL_BOARD_DIRECTORY",
      requiredFields: ["bodyName", "bodyClass", "homepageUrl", "jurisdictionName", "coverage", "coverageEvidence"],
      identity: { namespace: `${jurisdiction.id}:body-directory`, keyFields: ["bodyName", "homepageUrl"] },
      completenessScope: `Every official body of ${jurisdiction.name}, including subordinate bodies. Each record's identity, classification and territory must appear on a saved official page. When legal coverage is the entirety of specific Census divisions rather than the parent jurisdiction, extract territoryNames as the source's semicolon-separated division names, coverage as "entire listed divisions", and coverageEvidence containing the official page's legal coverage statement. Every name must join exactly one registered division in this state. A partial division, ambiguous name or unrecorded boundary remains owed; do not infer territory from a mailing address.` } };
}

/**
 * These legacy worker contracts acquire the same meeting event feeds now
 * owned by permanent SOURCE_WIRING-derived meeting-partition contracts. They
 * remain readable as immutable engineering evidence, but the standing runtime
 * may never schedule or dispatch another acquisition for them.
 */
export const RETIRED_ROUTINE_MEETING_ACQUISITION_CLASSES = [
  "LEGISTAR_EVENTS",
  "CIVICCLERK_EVENTS",
] as const;

export function isRetiredRoutineMeetingAcquisition(
  contract: CivicExtractionContract,
): boolean {
  return contract.schemaVersion === 1 &&
    (RETIRED_ROUTINE_MEETING_ACQUISITION_CLASSES as readonly string[]).includes(contract.recordClass);
}

/** Work instructions, never evidence or a readiness label. Stored with the owed WorkItem. */
export interface AutonomousWorkPlan {
  /** The mission part this work belongs to (CH-16), set where the plan is built. Read it with `missionPartOfPlan`. */
  readonly missionPart?: string;
  readonly directorySubject?: { readonly jurisdiction: Jurisdiction; readonly divisionId: string | null };
  readonly ownerInstructions?: readonly string[];
  /** Existing reader door selected by the system's exact body join, never by a model. */
  readonly publication?:
    { readonly contractId: "registry-runtime-bindings" | WorkerReaderContract | "campaign-finance" | "special-district-boundaries"; readonly bodyId: string };
  readonly freshness?: Pick<FreshnessObligation,"readerImpactAt"|"observedChangeRateHours"|"declaredCycleHours">;
  readonly version: 1;
  readonly contract: CivicExtractionContract;
  readonly capability: string;
  readonly jurisdiction: string;
  readonly sourceRegistryReferences: readonly string[];
  readonly seedUrls: readonly string[];
  readonly sources: readonly ObservedResearchRoute[];
  readonly acquisition: readonly AcquirerTaskSpec[];
  readonly engineering: readonly EngineeringTaskSpec[];
  readonly auditScope: "CAPTURED_ARTIFACT" | "SOURCE_UNIVERSE";
}

/** Attach a newly implemented Reader connection without replacing retained
 * extraction instructions, acquired evidence, or independent worker results. */
export function inheritPublicationConnection(existing: AutonomousWorkPlan | undefined, current: AutonomousWorkPlan | undefined): AutonomousWorkPlan | undefined {
  if (!existing) return current;
  if (!current?.publication || existing.publication || existing.contract.subjectId !== current.contract.subjectId ||
    existing.contract.recordClass !== current.contract.recordClass) return existing;
  return { ...existing, publication: current.publication,
    ...(current.directorySubject ? { directorySubject: current.directorySubject } : {}) };
}

/** A content-addressed artifact keeps its first retrieval stamp; a later successful
 * network rung records a real re-observation without rewriting that immutable identity. */
export function scheduleAutonomousAcquisition(plan:AutonomousWorkPlan,result:AcquirerResult,now:string) {
  const captured=result.artifacts.filter(artifact=>artifact.completeness==="COMPLETE");
  const timestamps=[...captured.map(artifact=>artifact.retrievedAt),...result.walk.filter(step=>step.rung===result.source.retrieval&&step.transport==="REACHABLE"&&step.outcome==="WALKED_AND_FOUND"&&captured.some(artifact=>step.artifactIds.includes(artifact.artifactId))).map(step=>step.at)];
  const lastWorkedAt=timestamps.filter(value=>Number.isFinite(Date.parse(value))).sort().at(-1)??null;
  return scheduleObligation({id:`autonomous-source:${result.source.subjectId}:${result.source.id}`,subjectId:result.source.subjectId,recordClass:plan.contract.recordClass,
    routeId:result.source.id,active:true,readerImpactAt:plan.freshness?.readerImpactAt??null,observedChangeRateHours:plan.freshness?.observedChangeRateHours??null,
    declaredCycleHours:plan.freshness?.declaredCycleHours??null,lastWorkedAt},Date.parse(now));
}
