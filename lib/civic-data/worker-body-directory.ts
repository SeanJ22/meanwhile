import { canonicalJson, type ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { createWorkItem, type WorkItem } from "../control-plane/work-item.ts";
import { registerWorkItem } from "../control-plane/repository/coordinator.ts";
import { jurisdictionDiscoveryPlan, publicCommentDiscoveryPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { RegistryRuntimePackage, RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import type { Body, BodyClass } from "../registry/types.ts";
import type { JurisdictionSource } from "../hunt/jurisdiction-universe.ts";
import { verifiedWorkerRecords, requirePublication } from "./worker-publication-evidence.ts";
import { subBodyId } from "./meeting-body-crosswalk.ts";
import type { JurisdictionRouteHints } from "../hunt/meetings-route-hints.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";

/** Published directory routes feed the existing meeting walk. They remain
 * leads until that walk, crosswalk reviewer and meeting publisher verify them. */
export function directoryMeetingHints(items: readonly WorkItem[], registry: RegistryRuntimeReadModel,
  baseline: readonly JurisdictionRouteHints[]): readonly JurisdictionRouteHints[] {
  const hints = new Map(baseline.map(hint => [hint.jurisdictionId, hint]));
  for (const item of items) {
    const jurisdictionId = item.autonomousPlan?.directorySubject?.jurisdiction.id;
    const publication = item.publicationOutcome;
    if (!jurisdictionId || !publication?.bodyIds?.length || publication.status === "HELD") continue;
    const before = hints.get(jurisdictionId) ?? { jurisdictionId, officialSite: null, routes: [] };
    const additions = registry.registry.bodies.filter(body => publication.bodyIds!.includes(body.id) && body.homepageUrl && body.name)
      .map(body => ({ url: body.homepageUrl!, kind: "PAGE" as const, body: body.name!, platform: "official-page-events",
        verifyAs: "official-page-events" as const,
        evidence: `Independently verified directory ${item.id}, published version ${publication.versionId}; ${body.provenance.sourceUrl}. Calendar acquisition and attribution remain owed.`,
        observed: { at: body.provenance.verifiedAt ?? publication.at, by: publication.workerResultId } }));
    hints.set(jurisdictionId, { ...before, routes: [...before.routes, ...additions.filter(row => !before.routes.some(old => old.url === row.url))] });
  }
  return [...hints.values()];
}

const words = (value: unknown) => typeof value === "string" ? value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() : "";
const bodyClasses: Record<string, BodyClass> = { governing: "GOVERNING", advisory: "ADVISORY", commission: "COMMISSION", regional: "REGIONAL",
  "private association": "PRIVATE_ASSOCIATION", "executive agency": "EXECUTIVE_AGENCY", "sovereign tribal": "SOVEREIGN_TRIBAL" };

/** Directory facts enter the existing registry door only after the complete
 * independent chain and territory assertion pass. Unresolved rows stay owed. */
export function workerBodyDirectoryPackage(input: Parameters<typeof verifiedWorkerRecords>[0] & { prior: RegistryRuntimePrior }): {
  prepared: RegistryRuntimePackage; unresolved: readonly string[];
} {
  const checked = verifiedWorkerRecords(input);
  const subject = input.plan.directorySubject;
  requirePublication(checked.contract.recordClass === "OFFICIAL_BOARD_DIRECTORY" && subject &&
    subject.jurisdiction.id === checked.contract.subjectId, "DIRECTORY_SCOPE_MISSING");
  const division = input.prior.payload.registry.divisions.find(d => d.ocdId === subject.divisionId);
  requirePublication(division, "DIRECTORY_CENSUS_DIVISION_UNRESOLVED");
  const bodies: Body[] = [], unresolved: string[] = [];
  for (const record of checked.extraction.records) {
    try {
      const f = record.fields;
      requirePublication(Object.keys(f).every(key => ["bodyName", "bodyClass", "homepageUrl", "jurisdictionName", "coverage", "coverageEvidence", "territoryNames"].includes(key)), "DIRECTORY_FIELD_UNSUPPORTED");
      const classification = bodyClasses[words(f.bodyClass)];
      requirePublication(classification && words(f.bodyName) && typeof f.homepageUrl === "string", "DIRECTORY_BODY_IDENTITY_MISSING");
      const url = new URL(f.homepageUrl as string);
      requirePublication(url.protocol === "https:" && !url.username && !url.password, "DIRECTORY_PUBLIC_URL_INVALID");
      requirePublication([words(subject.jurisdiction.name), words(division.label)].includes(words(f.jurisdictionName)), "DIRECTORY_JURISDICTION_MISMATCH");
      const named = typeof f.territoryNames === "string" ? f.territoryNames.split(";").map(name => name.trim()).filter(Boolean) : [];
      const territory = named.length ? named.map(name => {
        // These are independently captured legal coverage statements, not
        // address geocoding. Ambiguous same-name divisions never become joins.
        const matches = input.prior.payload.registry.divisions.filter(row => row.state === division.state && words(row.label) === words(name));
        requirePublication(matches.length === 1 && words(f.coverageEvidence).includes(words(name)), "DIRECTORY_NAMED_TERRITORY_UNRESOLVED");
        return matches[0];
      }) : [division];
      requirePublication(named.length ? words(f.coverage) === "entire listed divisions" :
        ["entire jurisdiction", "entire division", "citywide", "townwide", "countywide", "statewide", "districtwide"].includes(words(f.coverage)) &&
        words(f.coverageEvidence).includes(words(f.jurisdictionName)), "DIRECTORY_TERRITORY_REQUIRES_REPAIR");
      const territoryIds = [...new Set(territory.map(row => row.ocdId))].sort();
      requirePublication(territoryIds.length === territory.length, "DIRECTORY_DUPLICATE_TERRITORY");
      const existing = input.prior.payload.registry.bodies.filter(body => (body.ocdId !== null && territoryIds.includes(body.ocdId) ||
        words(body.name) === words(f.bodyName) && body.homepageUrl === url.href) &&
        (words(body.name) === words(f.bodyName) || (body.id === input.plan.publication?.bodyId && !body.name && body.bodyClass === classification)));
      requirePublication(existing.length <= 1, "DIRECTORY_BODY_IDENTITY_AMBIGUOUS");
      // Same name on another territory is a cross-territory identity question,
      // not permission to duplicate a regional body under a second government.
      const prior = existing[0];
      requirePublication(!prior || [prior.ocdId, ...(prior.alsoServesOcdIds ?? [])].every(id => id !== null && territoryIds.includes(id)), "DIRECTORY_SHARED_BODY_TERRITORY_REQUIRES_REPAIR");
      const primaryDivision = prior?.ocdId ?? territoryIds[0];
      const id = prior?.id ?? subBodyId(primaryDivision, String(f.bodyName));
      requirePublication(!bodies.some(body => body.id === id), "DIRECTORY_DUPLICATE_BODY");
      bodies.push({ ...(prior ?? { id, ocdId: primaryDivision, coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE",
        agendaSourceRef: null, meetingCadence: null, demandCount: 0 }), name: String(f.bodyName), bodyClass: classification,
        alsoServesOcdIds: territoryIds.filter(id => id !== primaryDivision),
        homepageUrl: url.href, bodyOrigin: "SOURCED", sourceDataset: "GOV_DIRECTORY",
        provenance: { sourceUrl: checked.primary.evidence.canonicalUrl, sourceOrg: checked.contract.sourceScope.publisher,
          collectedAt: checked.primary.observedAt, verifiedAt: input.now } });
    } catch (error) {
      unresolved.push(`${record.id}: ${error instanceof Error ? error.message : "DIRECTORY_ROW_REQUIRES_REPAIR"}`);
    }
  }
  requirePublication(bodies.length > 0, `DIRECTORY_NO_ADMISSIBLE_BODY:${unresolved.join("; ")}`);
  return { unresolved, prepared: { contractId: "registry-runtime-bindings", version: `worker-directory:${input.validator.id}`,
    sourceThrough: input.now, sourceReceipt: checked.sourceReceipt,
    payload: { ...input.prior.payload, registry: { ...input.prior.payload.registry, divisions: [], bodies },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { ...input.prior.payload.officialCandidacies, rows: [] } } } };
}

/** Idempotent normal-worker continuation. Same government subject preserves
 * scope-budget joins; bodies and record families have distinct work identities.
 * Election/finance remain on their existing shared custodian obligations. */
export async function materializeBodyDirectoryWork(input: { repos: ControlPlaneRepositories; parent: WorkItem; bodies: readonly Body[]; now: string }): Promise<void> {
  const parent = input.parent, plan = parent.autonomousPlan, jurisdiction = plan?.directorySubject?.jurisdiction;
  requirePublication(plan?.ownerInstructions?.length && jurisdiction, "DIRECTORY_OWNER_INSTRUCTIONS_MISSING");
  for (const body of input.bodies) {
    const scope = { ...jurisdiction, bodyId: body.id, ownWebAddress: body.homepageUrl };
    const families = ["OFFICEHOLDERS", "PUBLIC_SERVICES", "PUBLIC_COMMENT"] as const;
    for (const family of families) {
      const source: JurisdictionSource = { recordClass: family, authority: body.name ?? jurisdiction.name,
        authorityBasis: `Independently verified directory body ${body.id}; downstream facts are not yet acquired.`,
        scope: "THIS_JURISDICTION", routeId: `body:${body.id}:${family}`, url: body.homepageUrl, state: "DISCOVERY_OWED",
        owed: `Acquire and independently verify ${family} for ${body.name}; use inherited methods and preserve all unresolved applicability.`,
        citation: body.provenance.sourceUrl ?? "" };
      const template = family === "PUBLIC_COMMENT" ? publicCommentDiscoveryPlan(scope, body.id) : jurisdictionDiscoveryPlan(scope, source, source.routeId!, body.id);
      requirePublication(template, "DIRECTORY_CHILD_INSTRUCTIONS_MISSING");
      const childPlan = { ...template, ownerInstructions: plan.ownerInstructions };
      const child = createWorkItem({ project: parent.project, subject: parent.subject, obligation: `Verified body ${body.id}: ${family}`,
        why: `Directory ${parent.id} admitted this exact body; normal acquisition, independent verification and automatic publication remain owed.`,
        priority: parent.priority, question: parent.question, contract: parent.contract,
        dependencies: [{ upstreamId: parent.id, kind: "PRODUCES_CONSUMES", reason: "Verified body identity and territorial authority",
          evidence: [body.id, body.provenance.sourceUrl ?? "", parent.publicationOutcome?.versionId ?? ""] }], now: input.now });
      const shared = (await input.repos.workItems.list()).find(row => row.value.project === parent.project && row.value.subject === parent.subject &&
        row.value.autonomousPlan?.publication?.bodyId === body.id && row.value.autonomousPlan.contract.recordClass === childPlan.contract.recordClass);
      const prior = shared ? await input.repos.workItems.mustRead(shared.id) : await input.repos.workItems.read(child.id);
      if (!prior) await registerWorkItem(input.repos, { ...child, autonomousPlan: childPlan,
        directoryParent: { workItemId: parent.id, bodyId: body.id, versionId: parent.publicationOutcome!.versionId! } }, input.now);
      else {
        requirePublication(prior.value.autonomousPlan?.publication?.bodyId === body.id && prior.value.subject === parent.subject, "DIRECTORY_CHILD_IDENTITY_CONFLICT");
        const inherited = [...new Set([...(prior.value.autonomousPlan.ownerInstructions ?? []), ...plan.ownerInstructions])];
        if (canonicalJson(inherited) !== canonicalJson(prior.value.autonomousPlan.ownerInstructions)) {
          await input.repos.workItems.compareAndSet(prior.id, prior.revision, { ...prior.value,
            autonomousPlan: { ...prior.value.autonomousPlan, ownerInstructions: inherited } }, input.now);
        }
      }
    }
  }
}
