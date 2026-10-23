import { stateRegistryRuntimeContractId, type StateRegistryContractId } from "../../civic-data/state-scopes.ts";
import { workerDoorForRecord } from "../../civic-data/worker-reader-contracts.ts";
import type { CivicExtractionContract } from "./types.ts";
import type { AcquirerTaskSpec, ObservedResearchRoute } from "./research-types.ts";
import { scheduleObligation, type FreshnessObligation } from "../scheduler/obligation.ts";
import type { AcquirerResult } from "./research-types.ts";
import type { Jurisdiction, JurisdictionSource } from "../../hunt/jurisdiction-universe.ts";
import type { COMMENT_RULE_PUBLICATION, WorkerReaderContract } from "../../civic-data/worker-reader-contracts.ts";
import { missionPartOf } from "../expansion/mission-parts.ts";

/** The mission part a plan's record class starts in; omitted when no part takes it. */
function partFor(recordClass: string): { readonly missionPart?: string } {
  const part = missionPartOf({ recordClass });
  return part ? { missionPart: part } : {};
}

/** Initial instructions for an owner-requested family. Registry addresses are leads, never invented observations; an evidence-backed repair supplies the extraction mapping. */
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
  const state = jurisdiction.stateCode.toUpperCase();
  const publicationContract = workerDoorForRecord(spec.recordClass, state);
  return {
    version: 1, capability: source.recordClass === "OFFICEHOLDERS" ? "officials/offices" : source.recordClass, jurisdiction: state,
    sourceRegistryReferences: [jurisdiction.id, routeId], seedUrls, sources: [], acquisition: [], auditScope: "SOURCE_UNIVERSE",
    ...partFor(spec.recordClass),
    ...(bodyId && publicationContract ? { publication: { contractId: publicationContract, bodyId } } : {}),
    ...(source.recordClass === "OFFICEHOLDERS" && bodyId ? { publication: { contractId: stateRegistryRuntimeContractId(state), bodyId } } : {}),
    ...(source.recordClass === "PUBLIC_SERVICES" && bodyId ? { publication: { contractId: "everyday-routing" as const, bodyId } } : {}),
    ...(source.recordClass === "VOTER_ACCESS" && bodyId ? { publication: { contractId: "ballot-navigation" as const, bodyId } } : {}),
    ...(spec.recordClass === "PUBLIC_RECORD" && bodyId ? { publication: { contractId: source.recordClass === "SPECIAL_DISTRICT_BOUNDARIES" ? "special-district-boundaries" as const : source.recordClass === "GOVERNMENT_FINANCE" ? "government-budgets" as const : "public-records" as const, bodyId } } : {}),
    ...(["ADOPTED_BUDGET", "BUDGET_RESPONSIBILITY", "BUDGET_AMENDMENT"].includes(spec.recordClass) && bodyId ? { publication: { contractId: "government-budgets" as const, bodyId } } : {}),
    ...(["CANDIDATE_FILING_DOCUMENT", "CAMPAIGN_FINANCE_FILING"].includes(spec.recordClass) && bodyId ? { publication: { contractId: "official-filings" as const, bodyId } } : {}),
    contract: {
      schemaVersion: 2, recordClass: spec.recordClass, subjectId: jurisdiction.id,
      requiredFields: spec.fields, identity: { namespace: `${jurisdiction.id}:${source.recordClass}`, keyFields: spec.fields },
      jurisdiction: { country: "US", state, canonicalId: jurisdiction.id },
      completenessScope: `${source.recordClass} for ${jurisdiction.name}. ${source.owed ?? source.authorityBasis} This initial source contract does not discharge downstream information families or establish publisher absence.`,
      // Discovery templates acquire their method version when the runtime binds them.
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
    routeId, url: jurisdiction.ownWebAddress, state: "DISCOVERY_OWED", owed: "Find the body's published public-comment rules, including signup, written comments, attendance and speaking limits. Take each from a source that states it and can be checked; do not infer permission to speak from an open meeting.",
    citation: `Registered government ${jurisdiction.id}, body ${bodyId}.` }, routeId, bodyId)!;
  if (base.contract.schemaVersion !== 2) throw new Error("PUBLIC_COMMENT_TEMPLATE_INVALID");
  return { ...base, capability: "meetings/public-comment", publication: { contractId: "comment-access", bodyId }, ...partFor("PUBLIC_COMMENT_RULE"),
    sourceRegistryReferences: [...base.sourceRegistryReferences, bodyId],
    contract: { ...base.contract, recordClass: "PUBLIC_COMMENT_RULE", requiredFields: ["bodyName", "commentPeriod", "commentPeriodDetail"],
      identity: { namespace: `${jurisdiction.id}:public-comment`, keyFields: ["bodyName"] },
      completenessScope: `Published participation rules for registered body ${bodyId}. YES, NO or UNKNOWN must describe what the source actually supports. Each instruction must appear in a saved source that can be checked; this work does not discharge calendars, agendas, minutes or other bodies.` } };
}

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
  /** Scrubbed Ask work, carried into the existing hunter's place brief. */
  readonly readerQuestion?: { readonly origin: "ASK"; readonly text: string; readonly place: string | null; readonly divisions: readonly string[] };
  /** Sourced population of the subject, when held; used to order election-site blanks. */
  readonly subjectPopulation?: number;
  /** County election-office probe outcome; orders voting-source work without retaining the answer. */
  readonly votingGoogleAvailable?: boolean;
  /** The mission part this work belongs to, set where the plan is built. Read it with `missionPartOfPlan`. */
  readonly missionPart?: string;
  readonly directorySubject?: { readonly jurisdiction: Jurisdiction; readonly divisionId: string | null };
  readonly ownerInstructions?: readonly string[];
  /** Existing reader door selected by the system's exact body join, never by a model. */
  readonly publication?:
    { readonly contractId: StateRegistryContractId | typeof COMMENT_RULE_PUBLICATION | WorkerReaderContract | "campaign-finance" | "special-district-boundaries"; readonly bodyId: string };
  readonly freshness?: Pick<FreshnessObligation,"readerImpactAt"|"observedChangeRateHours"|"declaredCycleHours">;
  readonly version: 1;
  readonly contract: CivicExtractionContract;
  readonly capability: string;
  readonly jurisdiction: string;
  readonly sourceRegistryReferences: readonly string[];
  readonly seedUrls: readonly string[];
  readonly sources: readonly ObservedResearchRoute[];
  readonly acquisition: readonly AcquirerTaskSpec[];
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
