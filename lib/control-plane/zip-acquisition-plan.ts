/** Executable read-only planning against existing provider IDs; never registers work. */
import type { PreparedZipQueues, SharedZipResearch } from "./zip-queue.ts";
import type { RegistryPass, RegisteredUnit } from "./scheduler/registry.ts";
import type { FreshnessOccurrence } from "./scheduler/durable.ts";
import type { WorkItem } from "./work-item.ts";
import type { RouteTask } from "./route-task.ts";
import { ENRICHMENT_FIELDS, type CandidateUniverse } from "../hunt/candidate-universe.ts";

export const ZIP_ACQUISITION_PLAN_CONTRACT = "fleet/zip-acquisition-plan@1";
export interface ZipAcquisitionPlanInput {
  readonly queues: PreparedZipQueues;
  readonly registry: Pick<RegistryPass, "units" | "byProvider">;
  readonly corpora: readonly CandidateUniverse[];
  /** Explicit fields from the same committed snapshot meetingsProvider reads. No guessed ID conversion. */
  readonly meetings: readonly { readonly bodyId?: string | null; readonly ocdId: string | null }[];
  /** Caller supplies latest committed revisions, not synthetic occurrences or tasks. */
  readonly historical: {
    readonly source: string;
    readonly occurrences: readonly FreshnessOccurrence[];
    readonly workItems: readonly WorkItem[];
    readonly routeTasks: readonly RouteTask[];
  };
}

export interface ZipAcquisitionBinding {
  readonly ref: string;
  readonly kind: SharedZipResearch["kind"];
  readonly zipConsumers: readonly string[];
  readonly assignment: "DIRECT_SUBJECT" | "MEETINGS_ONLY" | "NO_OWED_ENRICHMENT" | "MISSING_ASSIGNMENT" | "AMBIGUOUS";
  readonly obligationIds: readonly string[];
  /** A corpus can feed enrichment without having an assigned source-refresh obligation. */
  readonly downstreamReuseObligationIds: readonly string[];
  readonly evidence: readonly string[];
  readonly limitation: string;
}

export interface ZipAcquisitionUnit {
  readonly obligationId: string;
  readonly providerId: string;
  readonly subjectId: string;
  readonly recordClass: string;
  readonly routeId: string;
  readonly executorClass: RegisteredUnit["route"]["executorClass"];
  readonly openingKind: RegisteredUnit["route"]["open"]["kind"];
  readonly routeBlocker: string | null;
  readonly citation: string;
  readonly refs: readonly string[];
  readonly historicalTasks: readonly { readonly occurrenceId: string; readonly workItemId: string; readonly routeTaskId: string; readonly openedAt: string; readonly closedAt: string | null; readonly taskState: RouteTask["state"] }[];
  readonly unresolvedHistoricalLinks: readonly string[];
}

/** Resolves an authority record's complete route portfolio; multiple representations are not ambiguity. */
export function planZipAcquisition(input: ZipAcquisitionPlanInput) {
  const unitsBySubject = new Map<string, RegisteredUnit[]>();
  const unitsById = new Map<string, RegisteredUnit[]>();
  for (const unit of input.registry.units) {
    unitsBySubject.set(unit.record.subjectId, [...(unitsBySubject.get(unit.record.subjectId) ?? []), unit]);
    unitsById.set(unit.obligation.id, [...(unitsById.get(unit.obligation.id) ?? []), unit]);
  }
  const candidateById = new Map<string, CandidateUniverse["candidacies"][number][]>();
  for (const corpus of input.corpora) for (const candidate of corpus.candidacies) {
    candidateById.set(candidate.id, [...(candidateById.get(candidate.id) ?? []), candidate]);
  }
  const used = new Map<string, Set<string>>();
  const requestedCandidates = new Set(input.queues.sharedResearch.filter(ref => ref.kind === "candidacy").map(ref => ref.canonicalId));
  const bindings: ZipAcquisitionBinding[] = input.queues.sharedResearch.map(ref => {
    let matches: RegisteredUnit[] = [];
    let downstream: RegisteredUnit[] = [];
    let assignment: ZipAcquisitionBinding["assignment"] = "MISSING_ASSIGNMENT";
    const evidence: string[] = [];
    let limitation = "No exact typed assignment in the supplied provider pass; this is not evidence of an absent public record.";
    if (ref.kind === "candidacy") {
      const candidates = candidateById.get(ref.canonicalId) ?? [];
      if (candidates.length > 1) {
        assignment = "AMBIGUOUS";
        limitation = "Multiple corpus rows claim this canonical candidacy; reconcile identity before selecting an assignment.";
      } else {
        matches = (unitsBySubject.get(ref.canonicalId) ?? []).filter(unit => unit.record.recordClass === "candidate-enrichment");
        if (matches.length) { assignment = "DIRECT_SUBJECT"; evidence.push(`CandidateUniverse.candidacies.id = ProvidedObligation.subjectId = ${ref.canonicalId}`); }
        else if (candidates.length === 1 && ENRICHMENT_FIELDS.every(field => candidates[0].enrichment[field].state === "FOUND")) assignment = "NO_OWED_ENRICHMENT";
        limitation = "Assignment covers existing enrichment obligations only; held applicable candidacies do not establish the authority's full universe or source freshness.";
      }
    } else if (ref.kind === "jurisdiction") {
      const bodyIds = new Set(input.meetings.filter(meeting => meeting.ocdId === ref.canonicalId).map(meeting => meeting.bodyId ?? ref.canonicalId));
      matches = [...bodyIds].flatMap(id => unitsBySubject.get(id) ?? []).filter(unit => unit.record.recordClass === "meetings");
      if (matches.length) {
        assignment = "MEETINGS_ONLY";
        evidence.push(`data/meetings-snapshot.json: ocdId ${ref.canonicalId} explicitly names bodyId(s) ${[...bodyIds].sort().join(", ")}`);
      }
      limitation = "Meeting membership does not assign territory resolution, body enumeration, officeholders, ballot or funding coverage. No OCD-to-jurisdiction slug is guessed.";
    } else {
      // This is a typed document-provenance edge, not a URL/hostname resemblance.
      const candidates = [...candidateById.values()].flat().filter(candidate => candidate.provenance.some(citation => citation === ref.canonicalId || citation.startsWith(`${ref.canonicalId} — `)));
      downstream = candidates.filter(candidate => requestedCandidates.has(candidate.id)).flatMap(candidate => unitsBySubject.get(candidate.id) ?? []).filter(unit => unit.record.recordClass === "candidate-enrichment");
      evidence.push(`CandidateUniverse.candidacies.provenance begins with exact document path ${ref.canonicalId}: ${new Set(candidates.map(candidate => candidate.id)).size} held candidacies`);
      limitation = "No source-refresh assignment is inferred from downstream enrichment. These IDs reuse existing corpus evidence; the source's complete acquisition universe remains a separate obligation.";
      const ambiguousCandidates = [...new Set(candidates.filter(candidate => requestedCandidates.has(candidate.id) && candidateById.get(candidate.id)!.length > 1).map(candidate => candidate.id))];
      if (ambiguousCandidates.length) {
        assignment = "AMBIGUOUS"; downstream = [];
        evidence.push(`Downstream reuse has conflicting canonical candidacies: ${ambiguousCandidates.sort().join(", ")}`);
      }
    }
    const all = [...matches, ...downstream];
    const collisions = all.filter(unit => (unitsById.get(unit.obligation.id)?.length ?? 0) !== 1);
    if (collisions.length) {
      assignment = "AMBIGUOUS";
      evidence.push(`Conflicting provider rows for IDs: ${[...new Set(collisions.map(unit => unit.obligation.id))].sort().join(", ")}`);
      matches = []; downstream = [];
    }
    const ids = (values: readonly RegisteredUnit[]) => [...new Set(values.map(unit => unit.obligation.id))].sort();
    for (const id of ids([...matches, ...downstream])) {
      const refs = used.get(id) ?? new Set<string>(); refs.add(ref.ref); used.set(id, refs);
    }
    return { ref: ref.ref, kind: ref.kind, zipConsumers: ref.zipConsumers, assignment,
      obligationIds: ids(matches), downstreamReuseObligationIds: ids(downstream), evidence, limitation };
  });
  const workById = new Map(input.historical.workItems.map(item => [item.id, item]));
  const taskById = new Map(input.historical.routeTasks.map(task => [task.id, task]));
  const units: ZipAcquisitionUnit[] = [...used].sort(([a], [b]) => a.localeCompare(b)).map(([id, refs]) => {
    const unit = unitsById.get(id)![0];
    const historicalTasks: ZipAcquisitionUnit["historicalTasks"][number][] = [];
    const unresolvedHistoricalLinks: string[] = [];
    for (const occurrence of input.historical.occurrences.filter(row => row.obligationId === id)) {
      const task = taskById.get(occurrence.routeTaskId); const work = workById.get(occurrence.workItemId);
      if (!task || !work || task.workItemId !== work.id || task.routeId !== unit.route.routeId || work.subject !== unit.record.subjectId) {
        unresolvedHistoricalLinks.push(occurrence.id); continue;
      }
      historicalTasks.push({ occurrenceId: occurrence.id, workItemId: work.id, routeTaskId: task.id,
        openedAt: occurrence.openedAt, closedAt: occurrence.closedAt, taskState: task.state });
    }
    return { obligationId: id, providerId: unit.providerId, subjectId: unit.record.subjectId,
      recordClass: unit.record.recordClass, routeId: unit.route.routeId, executorClass: unit.route.executorClass,
      openingKind: unit.route.open.kind, routeBlocker: unit.route.open.kind === "NOT_MACHINE_EXECUTABLE" ? unit.route.open.reason : unit.route.awaitingAdapter ?? null,
      citation: unit.route.citation, refs: [...refs].sort(),
      historicalTasks: historicalTasks.sort((a,b) => a.occurrenceId.localeCompare(b.occurrenceId)),
      unresolvedHistoricalLinks: unresolvedHistoricalLinks.sort() };
  });
  const coverageAssignments = [...input.queues.existingCompletion, ...input.queues.newExpansion].map(zip => ({
    zip: zip.zip, tierNextStep: zip.tierNextStep, completionRequirements: zip.completionRequirements,
    gaps: zip.gaps, assignment: "MISSING_TYPED_COVERAGE_ASSIGNMENT" as const, obligationIds: [] as string[],
    why: "Registry acquisition records have no typed edge to this ZIP's tier/playbook requirements; matched candidate/meeting work must not be represented as completing those requirements.",
  }));
  return { contract: ZIP_ACQUISITION_PLAN_CONTRACT, mode: "PLAN_ONLY" as const,
    activation: "NOT_AUTHORIZED" as const, runtimeObservation: "UNKNOWN" as const,
    historicalSource: input.historical.source, providers: input.registry.byProvider, bindings, units, coverageAssignments,
    counts: { references: bindings.length, directAssignments: bindings.filter(row => row.assignment === "DIRECT_SUBJECT").length,
      meetingsOnlyAssignments: bindings.filter(row => row.assignment === "MEETINGS_ONLY").length,
      missingReferenceAssignments: bindings.filter(row => row.assignment === "MISSING_ASSIGNMENT").length,
      ambiguousReferences: bindings.filter(row => row.assignment === "AMBIGUOUS").length,
      noOwedEnrichment: bindings.filter(row => row.assignment === "NO_OWED_ENRICHMENT").length,
      uniqueExistingObligationIds: units.length,
      historicalTaskLinks: units.reduce((sum, unit) => sum + unit.historicalTasks.length, 0),
      unresolvedHistoricalLinks: units.reduce((sum, unit) => sum + unit.unresolvedHistoricalLinks.length, 0),
      missingCoverageAssignments: coverageAssignments.length,
      sourceReuseOnlyReferences: bindings.filter(row => row.kind === "source-corpus" && row.downstreamReuseObligationIds.length > 0).length },
  };
}
