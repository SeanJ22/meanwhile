/** Recheck only previously named planning gaps using held canonical identity and source links. */
import type { planZipAcquisition } from "./zip-acquisition-plan.ts";
import type { RegisteredUnit, ProviderReport } from "./scheduler/registry.ts";
import type { Registry } from "../registry/types.ts";
import { slotsFor } from "../registry/derive.ts";
import { stateDivision } from "../hunt/zip-projection.ts";
import { sourcesOf, jurisdictionRegistryPath, type JurisdictionRegistry } from "../hunt/jurisdiction-universe.ts";
import { tierExceedsEvidence } from "../coverage/tier.ts";
import type { StampedZipRow } from "../coverage/zip-tier.ts";
import type { WorkItem } from "./work-item.ts";
import type { RouteTask } from "./route-task.ts";
import type { FreshnessOccurrence } from "./scheduler/durable.ts";

export interface ZipGapResolutionInput {
  readonly previous: ReturnType<typeof planZipAcquisition>;
  readonly registry: Registry;
  readonly jurisdictionRegistries: readonly JurisdictionRegistry[];
  readonly units: readonly RegisteredUnit[];
  readonly providers: readonly ProviderReport[];
  /** Exact URL fields projected from the named held document, with their field paths. */
  readonly sourceDocuments: readonly { readonly path: string; readonly urls: readonly { readonly field: string; readonly url: string }[] }[];
  readonly stamps: Readonly<Record<string, StampedZipRow>>;
  readonly zipStates: Readonly<Record<string, string>>;
  readonly historical: { readonly source: string; readonly workItems: readonly WorkItem[]; readonly routeTasks: readonly RouteTask[]; readonly occurrences: readonly FreshnessOccurrence[] };
}
export interface ZipGapResolution {
  readonly ref: string;
  readonly status: "NO_OWN_GOVERNMENT" | "DUPLICATE_LAYER" | "PARTIAL_EXISTING_PORTFOLIO" | "STATE_PORTFOLIO_UNASSIGNED" | "EXISTING_BODY_UNASSIGNED" | "SOURCE_REFRESH_UNASSIGNED" | "IDENTITY_UNRESOLVED" | "AMBIGUOUS";
  readonly bodyIds: readonly string[];
  readonly jurisdictionId: string | null;
  readonly existingObligationIds: readonly string[];
  readonly evidence: readonly string[];
  readonly pendingReads: readonly { readonly path: string; readonly selector: string; readonly required: string }[];
  readonly runtimeReads: readonly { readonly path: string; readonly selector: string; readonly required: string }[];
  readonly historical: { readonly basis: "COMMITTED_HISTORY_ONLY"; readonly source: string; readonly checkedSubjectIds: readonly string[]; readonly checkedRouteIds: readonly string[]; readonly workItemIds: readonly string[]; readonly routeTaskIds: readonly string[]; readonly unresolvedOccurrenceIds: readonly string[] };
  readonly limitation: string;
}

export function resolveZipPlanGaps(input: ZipGapResolutionInput) {
  const rows: ZipGapResolution[] = [];
  for (const gap of input.previous.bindings.filter(row => row.assignment === "MISSING_ASSIGNMENT")) {
    const id = gap.ref.slice(gap.kind.length + 1);
    const evidence: string[] = [];
    const pendingReads: ZipGapResolution["pendingReads"][number][] = [];
    const runtimeReads: ZipGapResolution["runtimeReads"][number][] = [];
    let status: ZipGapResolution["status"] = "IDENTITY_UNRESOLVED";
    let bodyIds: string[] = []; let existingObligationIds: string[] = [];
    let jurisdictionId: string | null = null;
    const namedRouteIds = new Set<string>();
    let limitation = "No typed mapping is inferred from a name, URL resemblance, or same-state membership.";
    if (gap.kind === "jurisdiction") {
      const stateRows = input.jurisdictionRegistries.flatMap(registry => registry.jurisdictions
        .filter(jurisdiction => jurisdiction.govClass === "STATE" && stateDivision(jurisdiction.stateCode) === id)
        .map(jurisdiction => ({ registry, jurisdiction })));
      const divisions = input.registry.divisions.filter(division => division.ocdId === id || division.canonicalOcdId === id);
      if (stateRows.length > 1 || divisions.length > 1) {
        status = "AMBIGUOUS";
        evidence.push("Multiple canonical registry rows match this exact state/division identity.");
      } else if (stateRows.length === 1) {
        status = "STATE_PORTFOLIO_UNASSIGNED";
        const { registry, jurisdiction } = stateRows[0];
        jurisdictionId = jurisdiction.id;
        const path = jurisdictionRegistryPath(registry.stateCode);
        evidence.push(`${path}: jurisdictions[id=${jurisdiction.id}].govClass=STATE; stateDivision(stateCode)=${id}`);
        for (const source of sourcesOf(registry, jurisdiction)) {
          if (source.routeId) namedRouteIds.add(source.routeId);
          // Explicit existing provider conventions, not generic record-class spelling conversion.
          const matches = source.routeId ? input.units.filter(unit => unit.route.routeId === source.routeId &&
            (source.recordClass === "CAMPAIGN_FINANCE" ? unit.providerId === "campaign-finance" && unit.record.recordClass === "campaign-finance"
              : unit.providerId === "local-jurisdictions" && unit.record.subjectId === jurisdiction.id)) : [];
          if (matches.length === 1) {
            existingObligationIds.push(matches[0].obligation.id);
            evidence.push(`${path}: ${jurisdiction.id}.sourceIds → sourceCatalog.routeId=${source.routeId} → ${matches[0].obligation.id}`);
          } else {
            if (matches.length > 1) status = "AMBIGUOUS";
            pendingReads.push({ path, selector: `jurisdictions[id=${jurisdiction.id}].sourceIds → sourceCatalog[routeId=${source.routeId ?? "null"}]`, required: matches.length > 1 ? "Disambiguate multiple existing obligations for this named method and authority." : "Read the canonical registry-provider output for this named source's own record class; no unit is currently supplied." });
          }
        }
        if (status !== "AMBIGUOUS" && existingObligationIds.length) status = "PARTIAL_EXISTING_PORTFOLIO";
        pendingReads.push({ path: "lib/control-plane/readiness/read.ts", selector: `ReadinessReadOutcome.HELD.snapshot[state=${registry.stateCode.toLowerCase()}].capabilities`, required: "Read the remaining state capability gaps and their existing canonical WorkItem dependencies; the matched source portfolio covers only its named record class." });
        runtimeReads.push({ path: "lib/control-plane/repository/types.ts", selector: `ControlPlaneRepositories.workItems.list(): value.subject === ${jurisdiction.id}`, required: "Resolve existing WorkItem IDs and autonomousPlan without creating any task." });
        runtimeReads.push({ path: "lib/control-plane/readiness/read.ts", selector: `readReadinessSnapshot(${registry.stateCode.toLowerCase()}): HELD.snapshot.capabilities`, required: "The actual read API takes state only; it owns the repository read and outcome classification. Do not call in this isolated session." });
        limitation = "Named state-source method IDs identify existing record-specific portfolios only; campaign-finance work does not complete state coverage or ballot acquisition.";
      } else if (divisions.length === 1) {
        const division = divisions[0]; const outcome = slotsFor(division);
        // A body↔DIVISION registry lookup (which bodies serve this division), not a
        // meeting↔body join. Bound to a local so it does not trip MTG-9's
        // `body.ocdId === X.ocdId` heuristic (tests/meeting-body-attribution.test.ts),
        // which bans attributing a MEETING to a body by shared division — a different join.
        const divisionOcdId = division.ocdId;
        evidence.push(`lib/registry/registry.json: divisions[ocdId=${division.ocdId}] canonicalOcdId=${division.canonicalOcdId ?? "null"}; funcstat=${division.funcstat ?? "null"}; lsad=${division.lsad ?? "null"}; slotsFor.skipped=${outcome.skipped ?? "null"}`);
        bodyIds = input.registry.bodies.filter(body => body.ocdId === divisionOcdId || body.alsoServesOcdIds?.includes(divisionOcdId)).map(body => body.id).sort();
        if (outcome.skipped === "statistical-or-unorganized") {
          status = "NO_OWN_GOVERNMENT";
          limitation = "Existing Census derivation establishes this polygon has no government of its own. Governments overlapping it remain owed; no ZIP coverage is closed.";
        } else if (outcome.skipped === "fictitious-duplicate-of-another-layer") {
          status = "DUPLICATE_LAYER";
          pendingReads.push({ path: "lib/registry/registry.json", selector: `divisions[ocdId=${division.ocdId}].geoid/canonicalOcdId`, required: "Identify the actual governing counterpart by a sourced canonical key; FUNCSTAT F does not identify that counterpart by itself." });
          limitation = "The duplicate layer does not justify a second government or an absence of the actual government's obligations.";
        } else if (bodyIds.length) {
          const matches = input.units.filter(unit => bodyIds.includes(unit.record.subjectId));
          existingObligationIds = [...new Set(matches.map(unit => unit.obligation.id))].sort();
          status = matches.length ? "PARTIAL_EXISTING_PORTFOLIO" : "EXISTING_BODY_UNASSIGNED";
          evidence.push(`lib/registry/registry.json: bodies.ocdId/alsoServesOcdIds matches the exact division: ${bodyIds.join(", ")}`);
          for (const bodyId of bodyIds) pendingReads.push({ path: "lib/registry/registry.json", selector: `bodies[id=${bodyId}]`, required: "Read the body's current canonical acquisition WorkItem/autonomousPlan and existing provider occurrence by exact subject. Held body identity alone supplies no task ID." });
          for (const bodyId of bodyIds) runtimeReads.push({ path: "lib/control-plane/repository/types.ts", selector: `ControlPlaneRepositories.workItems.list(): value.subject === ${bodyId}`, required: "Read existing WorkItem.id and autonomousPlan; pass the returned IDs to readAutonomousActivity. A missing row remains unassigned." });
        } else pendingReads.push({ path: "lib/registry/registry.json", selector: `divisions[ocdId=${division.ocdId}]; bodies.ocdId/alsoServesOcdIds`, required: "Resolve the named structural body obligation; unknown derivation codes cannot establish absence." });
      } else pendingReads.push({ path: "lib/registry/registry.json", selector: `divisions.ocdId/canonicalOcdId=${id}`, required: "Read a canonical division identity or an explicit registry identity crosswalk before assigning a jurisdiction provider subject." });
    } else if (gap.kind === "source-corpus") {
      status = "SOURCE_REFRESH_UNASSIGNED";
      const documents = input.sourceDocuments.filter(document => document.path === id);
      if (documents.length > 1) status = "AMBIGUOUS";
      const document = documents.length === 1 ? documents[0] : null;
      if (document) for (const location of document.urls) evidence.push(`${id}#${location.field}=${location.url}`);
      for (const registry of input.jurisdictionRegistries) for (const [sourceId, source] of Object.entries(registry.sourceCatalog)) {
        if (source.recordClass !== "BALLOT_AND_CANDIDATES" || !source.url || !document?.urls.some(location => location.url === source.url)) continue;
        evidence.push(`${jurisdictionRegistryPath(registry.stateCode)}#sourceCatalog[${sourceId}].url exactly matches held document metadata; routeId=${source.routeId ?? "null"}`);
        if (source.routeId) namedRouteIds.add(source.routeId);
        const subjectIds = new Set(registry.jurisdictions.filter(jurisdiction => jurisdiction.sourceIds.includes(sourceId)).map(jurisdiction => jurisdiction.id));
        const matches = source.routeId ? input.units.filter(unit => unit.route.routeId === source.routeId && unit.providerId === "local-jurisdictions" && subjectIds.has(unit.record.subjectId)) : [];
        if (matches.length > 1) status = "AMBIGUOUS";
        if (matches.length === 1) existingObligationIds.push(matches[0].obligation.id);
      }
      if (status !== "AMBIGUOUS" && existingObligationIds.length) status = "PARTIAL_EXISTING_PORTFOLIO";
      pendingReads.push({ path: id, selector: "authority/retrieval/provenance.sourceUrl", required: "Read this source universe's existing canonical acquisition WorkItem/autonomousPlan and its provider record/route ID; enrichment IDs are not source-refresh IDs." });
      pendingReads.push({ path: "lib/control-plane/scheduler/providers/local-jurisdictions.ts", selector: "schedulableSources; STATEWIDE exclusion", required: "Read the existing record-specific provider for statewide ballot sources, or establish a typed assignment under existing authority. Do not create another copy of an existing portfolio." });
      runtimeReads.push({ path: "lib/control-plane/repository/types.ts", selector: `ControlPlaneRepositories.workItems.list(): inspect autonomousPlan.sources and autonomousPlan.acquisition[].route.url against exact URL fields in ${id}`, required: "An exact source URL locates candidate WorkItems only; verify their extraction contract and subject universe before accepting an assignment. No source-to-subject ID is currently established." });
      limitation = "Held document URLs and registry source knowledge remain evidence only; no acquisition task or source permission is invented.";
    }
    if (status === "AMBIGUOUS") existingObligationIds = [];
    for (const obligationId of [...new Set(existingObligationIds)]) {
      const unit = input.units.find(unit => unit.obligation.id === obligationId)!;
      runtimeReads.push({ path: "lib/control-plane/repository/types.ts", selector: `ControlPlaneRepositories.occurrences.list(): value.obligationId === ${obligationId}; routeTasks.read(returned routeTaskId): routeId === ${unit.route.routeId}`, required: "Read the canonical occurrence and actual task identity; a matched provider ID is not a dispatch or lease proof." });
    }
    if (runtimeReads.some(read => read.selector.includes("workItems.list"))) runtimeReads.push({ path: "lib/control-plane/workers/activity.ts", selector: "readAutonomousActivity(repos, workItemIds): use only IDs returned by the preceding exact subject/verified source lookup", required: "Read attempts, leases, worker results and recovery history for the resolved existing work; no new task registration." });
    const subjects = [...bodyIds, ...(jurisdictionId ? [jurisdictionId] : [])];
    const historicalWork = new Set(input.historical.workItems.filter(work => subjects.includes(work.subject)).map(work => work.id));
    const historicalTasks = new Set(input.historical.routeTasks.filter(task => historicalWork.has(task.workItemId)).map(task => task.id));
    const unresolvedOccurrenceIds: string[] = [];
    for (const occurrence of input.historical.occurrences.filter(occurrence => existingObligationIds.includes(occurrence.obligationId))) {
      const unit = input.units.find(unit => unit.obligation.id === occurrence.obligationId)!;
      const work = input.historical.workItems.find(work => work.id === occurrence.workItemId && work.subject === unit.record.subjectId);
      const task = input.historical.routeTasks.find(task => task.id === occurrence.routeTaskId && task.workItemId === work?.id && task.routeId === unit.route.routeId);
      if (!work || !task) { unresolvedOccurrenceIds.push(occurrence.id); continue; }
      historicalWork.add(work.id); historicalTasks.add(task.id);
    }
    // Exact named routes without an authority/subject binding are candidate reads, not assignments.
    const namedRouteMatches = input.historical.routeTasks.filter(task => namedRouteIds.has(task.routeId));
    evidence.push(`${input.historical.source}: checked exact subject IDs [${subjects.join(", ")}], named route IDs [${[...namedRouteIds].sort().join(", ")}]; ${namedRouteMatches.length} historical tasks match named routes before subject/occurrence verification.`);
    rows.push({ ref: gap.ref, status, bodyIds, jurisdictionId, existingObligationIds: [...new Set(existingObligationIds)].sort(), evidence, pendingReads, runtimeReads,
      historical: { basis: "COMMITTED_HISTORY_ONLY", source: input.historical.source, checkedSubjectIds: subjects.sort(), checkedRouteIds: [...namedRouteIds].sort(), workItemIds: [...historicalWork].sort(), routeTaskIds: [...historicalTasks].sort(), unresolvedOccurrenceIds: unresolvedOccurrenceIds.sort() }, limitation });
  }
  const coverage = input.previous.coverageAssignments.map(row => {
    const stamp = input.stamps[row.zip] ?? null;
    const state = input.zipStates[row.zip];
    if (!state) throw new Error(`ZIP_GAP_STATE_UNRESOLVED:${row.zip}`);
    return { zip: row.zip, status: "COVERAGE_ASSIGNMENT_UNRESOLVED" as const, stampedTier: stamp?.tier ?? null,
      stampedAt: stamp?.stampedAt ?? null, evidence: stamp?.evidence ?? null,
      stampExceedsEvidence: stamp ? tierExceedsEvidence(stamp.tier, stamp.evidence) : null,
      existingObligationIds: [] as string[], requirements: row.completionRequirements,
      runtimeReads: [
        { path: "lib/control-plane/repository/types.ts", selector: `ControlPlaneRepositories.readinessSnapshots.read(${state}): select value.zips[zip=${row.zip}]`, required: "Require the current READINESS_DERIVATION_CONTRACT using readinessRowOutcome before trusting cells." },
        { path: "lib/control-plane/readiness/read.ts", selector: `readReadinessSnapshot(${state}): HELD.snapshot.zips[zip=${row.zip}]`, required: "Use the existing state-only API in an authorized runtime; no fresh or complete claim is supported by this historical plan." },
        { path: "lib/control-plane/repository/types.ts", selector: "ControlPlaneRepositories.workItems.list(): inspect exact subject and dependencies for named readiness capability/body IDs", required: "No canonical ZIP-playbook WorkItem mapping exists in the supplied evidence; readiness aggregate counts alone cannot supply task IDs." },
      ],
      pendingReads: [
        { path: "data/derived/zip-coverage-tiers.json", selector: `zips[${row.zip}].edges/evidence/unresolvedSpecialDistrictsInCounties`, required: "Resolve the stamped government's exact identity and territory obligations without converting county inventory into ZIP membership." },
        { path: "data/derived/zip-governments.json", selector: `zips[${row.zip}]`, required: "Read the canonical overlap edges against the external government denominator; no tier promotion from a provider count." },
        { path: "lib/control-plane/readiness/read.ts", selector: `ReadinessReadOutcome.HELD.snapshot.zips[zip=${row.zip}]`, required: "Read current authoritative readiness and the existing canonical WorkItem dependencies for the playbook requirements; a historical stamp is not a completion or dispatch proof." },
      ] };
  });
  return { contract: "fleet/zip-gap-resolution@1", baseContract: input.previous.contract, mode: "READ_ONLY_PLAN", activation: "NOT_AUTHORIZED", runtimeObservation: "UNKNOWN", providers: input.providers, rows, coverage,
    counts: { recheckedReferences: rows.length, noOwnGovernment: rows.filter(row => row.status === "NO_OWN_GOVERNMENT").length,
      duplicateLayers: rows.filter(row => row.status === "DUPLICATE_LAYER").length,
      partialExistingPortfolios: rows.filter(row => row.status === "PARTIAL_EXISTING_PORTFOLIO").length,
      existingBodiesUnassigned: rows.filter(row => row.status === "EXISTING_BODY_UNASSIGNED").length,
      statePortfoliosUnassigned: rows.filter(row => row.status === "STATE_PORTFOLIO_UNASSIGNED").length,
      sourceRefreshUnassigned: rows.filter(row => row.status === "SOURCE_REFRESH_UNASSIGNED").length,
      identityUnresolved: rows.filter(row => row.status === "IDENTITY_UNRESOLVED").length,
      ambiguous: rows.filter(row => row.status === "AMBIGUOUS").length,
      newlyMappedExistingObligationIds: new Set(rows.flatMap(row => row.existingObligationIds)).size,
      historicalWorkItems: new Set(rows.flatMap(row => row.historical.workItemIds)).size,
      historicalRouteTasks: new Set(rows.flatMap(row => row.historical.routeTaskIds)).size,
      unresolvedCoverageAssignments: coverage.length } };
}
