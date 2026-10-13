import { receiptSourceKind } from "./source-conflicts.ts";
import { parserFieldSources } from "./field-sources.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { createWorkItem, type WorkItem } from "../control-plane/work-item.ts";
import { registerWorkItem } from "../control-plane/repository/coordinator.ts";
import { jurisdictionDiscoveryPlan, publicCommentDiscoveryPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { RegistryRuntimePackage, RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import type { Body, BodyClass } from "../registry/types.ts";
import type { JurisdictionSource } from "../hunt/jurisdiction-universe.ts";
import { captureIntact, heldPageCopies, registryEdition, section3SourceReceipt, verifiedWorkerRecords, requirePublication } from "./worker-publication-evidence.ts";
import { readHeldDirectory } from "./worker-held-directory.ts";
import { pageWords, section3Page, section3Record } from "../control-plane/promotion/section3.ts";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { ArtifactRecord } from "../control-plane/repository/types.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { ensureEntity, learnOfficialHost } from "../facts/entities.ts";
import type { Clocks, FactDb, PublishOutcome, Query } from "../facts/publish.ts";
import { publishBodyFacts } from "../facts/roster-facts.ts";
import { createHash } from "node:crypto";
import { subBodyId } from "./meeting-body-crosswalk.ts";
import type { JurisdictionRouteHints } from "../hunt/meetings-route-hints.ts";
import type { RegistryRuntimeCarton } from "../registry/runtime-data-plane.ts";
import { DEFAULT_KINDS, kindFromSource, type KindTable } from "../registry/kinds.ts";

export function directoryMeetingHints(items: readonly WorkItem[], registry: RegistryRuntimeCarton,
  baseline: readonly JurisdictionRouteHints[]): readonly JurisdictionRouteHints[] {
  const hints = new Map(baseline.map(hint => [hint.jurisdictionId, hint]));
  for (const item of items) {
    const plan = item.autonomousPlan;
    const jurisdictionId = plan?.directorySubject?.jurisdiction.id ?? (plan?.publication?.contractId === "registry-runtime-bindings" ? plan.contract.subjectId : undefined);
    const publication = item.publicationOutcome;
    const bodyIds = publication?.bodyIds ?? (plan?.publication?.bodyId ? [plan.publication.bodyId] : []);
    if (!jurisdictionId || !publication || !bodyIds.length || publication.status === "HELD") continue;
    const before = hints.get(jurisdictionId) ?? { jurisdictionId, officialSite: null, routes: [] };
    const additions = registry.registry.bodies.filter(body => bodyIds.includes(body.id) && body.name)
      .flatMap(body => [...new Set([body.agendaSourceRef, body.homepageUrl].filter((url): url is string => Boolean(url)))].map(url => ({
        url, kind: "PAGE" as const, body: body.name!, platform: "official-page-events", verifyAs: "official-page-events" as const,
        evidence: `Independently verified ${url === body.agendaSourceRef ? "agenda link" : "home page"} from ${item.id}, published version ${publication.versionId}; ${body.provenance.sourceUrl}. Calendar acquisition and attribution remain owed.`,
        observed: { at: body.provenance.verifiedAt ?? publication.at, by: publication.workerResultId } })));
    hints.set(jurisdictionId, { ...before, routes: [...before.routes, ...additions.filter((row, index) =>
      !before.routes.some(old => old.url === row.url) && additions.findIndex(other => other.url === row.url) === index)] });
  }
  return [...hints.values()];
}

const words = (value: unknown) => typeof value === "string" ? value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() : "";

interface BodyOfficeContact { readonly bodyId: string; readonly capture: WorkerPublicationCapture; readonly address: string | null; readonly phone: string | null }

/** A directory body's office address and phone, each a fact on the body checked against the page that listed it. */
export async function publishBodyOffice(facts: FactDb & { readonly query: Query }, body: Body, contact: BodyOfficeContact, producedBy: string, clocks: Clocks, now: Date): Promise<readonly PublishOutcome[]> {
  await ensureEntity(facts.query, { id: body.id, kind: "body", name: body.name ?? body.id, state: /\/state:([a-z]{2})/.exec(body.id)?.[1]?.toUpperCase() ?? null, parentId: body.ocdId });
  await learnOfficialHost(facts.query, body.id, contact.capture.evidence.canonicalUrl);
  return publishBodyFacts(facts, { bodyId: body.id, capture: contact.capture, producedBy, facts: [["office_address", contact.address], ["office_phone", contact.phone]]
    .flatMap(([field, value]) => value ? [{ field: field as "office_address" | "office_phone", value, quote: value }] : []) }, clocks, now);
}

export function workerBodyDirectoryPackage(input: (Parameters<typeof verifiedWorkerRecords>[0] | { plan: AutonomousWorkPlan; now: string; held: DirectoryReading }) & { prior: RegistryRuntimePrior; kinds?: KindTable }): {
  prepared: RegistryRuntimePackage; unresolved: readonly string[]; contacts: readonly BodyOfficeContact[];
} {
  const checked: DirectoryChecked = "held" in input ? input.held.checked : verifiedWorkerRecords(input);
  const readingId = "held" in input ? input.held.id : input.parser.id;
  const subject = input.plan.directorySubject;
  requirePublication(checked.contract.recordClass === "OFFICIAL_BOARD_DIRECTORY" && subject &&
    subject.jurisdiction.id === checked.contract.subjectId, "DIRECTORY_SCOPE_MISSING");
  const division = input.prior.payload.registry.divisions.find(d => d.ocdId === subject.divisionId);
  requirePublication(division, "DIRECTORY_CENSUS_DIVISION_UNRESOLVED");
  const bodies: Body[] = [], unresolved: string[] = [], contacts: BodyOfficeContact[] = [];
  for (const record of checked.extraction.records) {
    try {
      const f = record.fields;
      requirePublication(Object.keys(f).every(key => ["bodyName", "bodyClass", "homepageUrl", "jurisdictionName", "coverage", "coverageEvidence", "territoryNames", "meetingCadence", "officeAddress", "officePhone"].includes(key)), "DIRECTORY_FIELD_UNSUPPORTED");
      // An office address and phone attach only as plain text found on the body's own page.
      const address = typeof f.officeAddress === "string" ? f.officeAddress.replace(/\s+/g, " ").trim() : "";
      const phone = typeof f.officePhone === "string" ? f.officePhone.replace(/\s+/g, " ").trim() : "";
      const office = { address: address.length >= 8 && address.length <= 200 && /\d/.test(address) ? address : null,
        phone: phone.length <= 40 && (phone.match(/\d/g) ?? []).length >= 7 ? phone : null };
      const classification = kindFromSource(input.kinds ?? DEFAULT_KINDS, "body", f.bodyClass) as BodyClass | null;
      requirePublication(classification && words(f.bodyName), "DIRECTORY_BODY_IDENTITY_MISSING");
      const url = typeof f.homepageUrl === "string" ? new URL(f.homepageUrl) : null;
      requirePublication(url === null || (url.protocol === "https:" && !url.username && !url.password), "DIRECTORY_PUBLIC_URL_INVALID");
      requirePublication(f.jurisdictionName === undefined || [words(subject.jurisdiction.name), words(division.label)].includes(words(f.jurisdictionName)), "DIRECTORY_JURISDICTION_MISMATCH");
      const named = typeof f.territoryNames === "string" ? f.territoryNames.split(";").map(name => name.trim()).filter(Boolean) : [];
      const territory = named.length ? named.map(name => {
                // Captured legal coverage statements, not geocoding; ambiguous same-name divisions never become joins.
        const matches = input.prior.payload.registry.divisions.filter(row => row.state === division.state && words(row.label) === words(name));
        requirePublication(matches.length === 1 && words(f.coverageEvidence).includes(words(name)), "DIRECTORY_NAMED_TERRITORY_UNRESOLVED");
        return matches[0];
      }) : [division];
      requirePublication(named.length ? words(f.coverage) === "entire listed divisions" : f.coverage === undefined ||
        ["entire jurisdiction", "entire division", "citywide", "townwide", "countywide", "statewide", "districtwide"].includes(words(f.coverage)), "DIRECTORY_TERRITORY_REQUIRES_REPAIR");
      const territoryIds = [...new Set(territory.map(row => row.ocdId))].sort();
      requirePublication(territoryIds.length === territory.length, "DIRECTORY_DUPLICATE_TERRITORY");
      const existing = input.prior.payload.registry.bodies.filter(body => (body.ocdId !== null && territoryIds.includes(body.ocdId) ||
        words(body.name) === words(f.bodyName) && url !== null && body.homepageUrl === url.href) &&
        (words(body.name) === words(f.bodyName) || (body.id === input.plan.publication?.bodyId && !body.name && body.bodyClass === classification)));
      requirePublication(existing.length <= 1, "DIRECTORY_BODY_IDENTITY_AMBIGUOUS");
      const prior = existing[0];
      requirePublication(!prior || [prior.ocdId, ...(prior.alsoServesOcdIds ?? [])].every(id => id !== null && territoryIds.includes(id)), "DIRECTORY_SHARED_BODY_TERRITORY_REQUIRES_REPAIR");
      const primaryDivision = prior?.ocdId ?? territoryIds[0];
      const id = prior?.id ?? subBodyId(primaryDivision, String(f.bodyName));
      requirePublication(!bodies.some(body => body.id === id), "DIRECTORY_DUPLICATE_BODY");
            // Never an undefined key, which the door hashes.
      const { meetingCadenceSource: _earlierSource, ...base } = prior ?? { id, ocdId: primaryDivision, coverageStatus: "NOT_ATTEMPTED" as const, agendaSourceType: "NONE" as const,
        agendaSourceRef: null, meetingCadence: null, demandCount: 0 };
      bodies.push({ ...(typeof f.meetingCadence === "string" ? base : prior ?? base), name: String(f.bodyName), bodyClass: classification,
        alsoServesOcdIds: territoryIds.filter(id => id !== primaryDivision),
        homepageUrl: url?.href ?? prior?.homepageUrl ?? null, bodyOrigin: "SOURCED", sourceDataset: "GOV_DIRECTORY",
        ...(typeof f.meetingCadence === "string" ? { meetingCadence: f.meetingCadence } : {}),
        ...("held" in input ? {} : { fieldSources: parserFieldSources(record.id, f,
          input.parser.result.role === "PARSER" ? input.parser.result.spans : [], input.captures, input.now) }),
        provenance: { kind: checked.sourceReceipt.sources.find(source => source.finalUrl === (checked.sourceOf?.get(record.id) ?? checked.primary).evidence.canonicalUrl)
          ? receiptSourceKind(checked.sourceReceipt.sources.find(source => source.finalUrl === (checked.sourceOf?.get(record.id) ?? checked.primary).evidence.canonicalUrl)!.sourceClass) : undefined,
          sourceUrl: (checked.sourceOf?.get(record.id) ?? checked.primary).evidence.canonicalUrl, sourceOrg: checked.contract.sourceScope.publisher,
          collectedAt: (checked.sourceOf?.get(record.id) ?? checked.primary).observedAt, verifiedAt: input.now } });
      if (office.address || office.phone) contacts.push({ bodyId: id, capture: checked.sourceOf?.get(record.id) ?? checked.primary, ...office });
    } catch (error) {
      unresolved.push(`${record.id}: ${error instanceof Error ? error.message : "DIRECTORY_ROW_REQUIRES_REPAIR"}`);
    }
  }
  requirePublication(bodies.length > 0, `DIRECTORY_NO_ADMISSIBLE_BODY:${unresolved.join("; ")}`);
  return { unresolved, contacts, prepared: { contractId: "registry-runtime-bindings", scope: "MEMBERS", version: registryEdition(`worker-directory:${readingId}`),
    sourceThrough: input.now, sourceReceipt: checked.sourceReceipt,
    payload: { ...input.prior.payload, registry: { ...input.prior.payload.registry, divisions: [], bodies },
      statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { ...input.prior.payload.officialCandidacies, rows: [] } } } };
}

type DirectoryChecked = Pick<ReturnType<typeof verifiedWorkerRecords>, "contract" | "primary" | "sourceReceipt"> & {
  readonly extraction: { readonly records: readonly { readonly id: string; readonly fields: Readonly<Record<string, unknown>> }[] };
  readonly sourceOf?: ReadonlyMap<string, WorkerPublicationCapture>;
};

export interface DirectoryReading { readonly id: string; readonly checked: DirectoryChecked }

export async function heldDirectoryReading(input: {
  plan: AutonomousWorkPlan; prior: RegistryRuntimePrior; now: string; artifacts: readonly ArtifactRecord[];
  readHeld: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>; limit?: number;
}): Promise<DirectoryReading | null> {
  const contract = input.plan.contract, subject = input.plan.directorySubject;
  if (contract.schemaVersion !== 2 || contract.recordClass !== "OFFICIAL_BOARD_DIRECTORY" || !subject) return null;
  const division = input.prior.payload.registry.divisions.find(d => d.ocdId === subject.divisionId);
  if (!division) return null;
  const candidates = heldPageCopies(input.artifacts, input.limit ?? 40);
  const records: { id: string; fields: Record<string, unknown> }[] = [], sourceOf = new Map<string, WorkerPublicationCapture>(), used: WorkerPublicationCapture[] = [];
    // The newest usable copy of each page speaks for it: an older copy never re-adds a board the newer one dropped,
    // and a later "Access Denied" capture never shadows a good one.
  const readUrls = new Set<string>();
  for (const artifact of candidates) {
    if (readUrls.has(artifact.canonicalUrl)) continue;
    const capture = await input.readHeld(artifact);
    if (!capture || !captureIntact(capture)) continue;
    const page = { url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt, sourcePolicy: capture.sourcePolicy, campaign: capture.campaign };
    const pageVerdict = section3Page(page, contract.recordClass, input.now);
    if (!pageVerdict.ok || !pageWords(capture.evidence.text).includes(division.label.toLowerCase())) continue;
    readUrls.add(artifact.canonicalUrl);
    const rows = readHeldDirectory(capture.evidence.text) ?? [];
    let kept = false;
    for (const row of rows) {
      const id = `held:${createHash("sha256").update(row.bodyName.toLowerCase()).digest("hex").slice(0, 16)}`;
      const verdict = section3Record({ recordClass: contract.recordClass, fields: { ...row }, page, now: input.now, pageVerdict });
      if (sourceOf.has(id) || !verdict.live) continue;
      // A schedule attaches only when code found it on the page; the body is live without it.
      const fields: Record<string, unknown> = { bodyName: row.bodyName, bodyClass: row.bodyClass };
      for (const key of ["meetingCadence", "officeAddress", "officePhone"] as const) if (verdict.verifiedFields.includes(key)) fields[key] = row[key];
      records.push({ id, fields }); sourceOf.set(id, capture); kept = true;
    }
    if (kept) used.push(capture);
  }
  if (!records.length) return null;
  const id = `held-directory:${createHash("sha256").update(used.map(c => c.evidence.contentHash).sort().join(" ") + canonicalJson(records)).digest("hex").slice(0, 16)}`;
  return { id, checked: { contract, primary: used[0], sourceOf, extraction: { records },
    sourceReceipt: section3SourceReceipt(used, input.now, `section3-validator:${id}`,
      `${records.length} body name(s) read in code from ${used.length} saved official directory page(s), each inside its freshness window (§3).`) } };
}

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
      const shared = (await input.repos.workItems.listWhere(["subject"], parent.subject)).find(row => row.value.project === parent.project && row.value.subject === parent.subject &&
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
