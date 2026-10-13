import { createHash } from "node:crypto";
import type { Body } from "../../registry/types.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { subBodyId } from "../../civic-data/meeting-body-crosswalk.ts";
import { registryRuntimeCandidate, readRegistryRuntimePrior, type RegistryRuntimePrior } from "../../registry/runtime-data-plane.ts";
import { projectReaderRoster } from "../../registry/body-rosters.ts";
import { processRegisteredManualCandidate } from "../../civic-data/promotion.ts";
import { acceptedRegistryPrior } from "../../civic-data/worker-roster-publication.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { legistarMemberRosters, memberSourceUrl, type LegistarMembers } from "./members.ts";

export function legistarMembersPackage(raw: LegistarMembers, rows: readonly BodySourceWiring[], prior: RegistryRuntimePrior, now: string) {
  const own = rows.filter(row => row.config.slug === raw.slug);
  if (!own.length) throw new Error("LEGISTAR_MEMBERS_TENANT_UNBOUND");
  const jurisdictions = new Set(own.map(row => row.ocdId));
  const parent = own[0];
  const unbound: string[] = [];
  const sourceUrl = memberSourceUrl(raw, "bodies", "BodyId");
  const bodies: Body[] = [];
  const bound: BodySourceWiring[] = [];
  for (const body of raw.bodies) {
    const wired = own.filter(row => Number(row.config.eventBodyId) === body.BodyId || !row.config.eventBodyId &&
      (row.config.eventBodyName || row.config.insiteBodyName) === body.BodyName);
    if (wired.length > 1 || wired.length === 0 && (jurisdictions.size !== 1 || parent.ocdId === null)) {
      unbound.push(`${raw.slug}:body:${body.BodyId}`); continue;
    }
    const owner = wired[0] ?? parent, ocdId = owner.ocdId;
    const id = wired[0]?.bodyId ?? subBodyId(ocdId!, body.BodyName);
    if (bound.some(row => row.bodyId === id)) throw new Error("LEGISTAR_MEMBERS_BODY_ID_COLLISION");
    const existing = prior.payload.registry.bodies.find(row => row.id === id);
    if (existing && existing.ocdId !== ocdId) throw new Error("LEGISTAR_MEMBERS_BODY_JURISDICTION_CONFLICT");
    if (!existing) {
      if (!body.BodyTypeName?.trim()) throw new Error("LEGISTAR_MEMBERS_BODY_TYPE_MISSING");
      bodies.push({ id, ocdId, name: body.BodyName, bodyClass: body.BodyTypeName, bodyOrigin: "SOURCED", coverageStatus: "KNOWN_UNCOVERED",
        agendaSourceType: "LEGISTAR", agendaSourceRef: null, meetingCadence: null, homepageUrl: null, demandCount: 0, sourceDataset: "GOV_DIRECTORY",
        provenance: { kind: "OFFICIAL", sourceUrl, sourceOrg: owner.publishingOrg, collectedAt: raw.collectedAt, verifiedAt: now } });
    }
    bound.push({ ...owner, bodyId: id, config: { ...owner.config, eventBodyId: String(body.BodyId), bodyName: body.BodyName } });
  }
  const projections = legistarMemberRosters(raw, bound, now).map(projectReaderRoster);
  if (projections.some(projection => projection.dispositions.some(disposition => disposition.state === "IDENTITY_UNRESOLVED"))) throw new Error("LEGISTAR_MEMBERS_PERSON_UNRESOLVED");
  const rosters = projections.map(projection => projection.roster);
  const departures = rosters.flatMap(roster => (prior.payload.bodyRosters.find(row => row.bodyId === roster.bodyId)?.members ?? [])
    .filter(member => !roster.members.some(row => row.id === member.id))
    .map(member => ({ bodyId: roster.bodyId, holderId: member.id, sourceUrl: roster.sourceUrl })));
  const candidacies = rosters.flatMap(roster => roster.members.filter(member => !prior.payload.officialCandidacies.rows.some(row => row.holder.id === member.id && row.holder.name === member.name && row.holder.officeTitle === member.officeTitle))
    .map(member => ({ holder: { id: member.id, name: member.name, officeTitle: member.officeTitle, divisions: bound.find(row => row.bodyId === roster.bodyId)?.ocdId ? [bound.find(row => row.bodyId === roster.bodyId)!.ocdId!] : [],
      authority: "REGISTRY_BODY_ROSTER" as const, sourceUrl: roster.sourceUrl }, status: "NOT_CHECKED" as const,
      candidacy: null, unresolvedCandidacyIds: [], reason: "The official office record establishes membership; ballot candidacy remains owed." })));
  return { contractId: "registry-runtime-bindings" as const, scope: "MEMBERS" as const, version: `legistar-members:${raw.slug}:${raw.signature}:${now.slice(0, 10)}`,
    sourceThrough: now, departures,
    excludedFacts: unbound.map(key => ({ key, code: "LEGISTAR_MEMBERS_BODY_JURISDICTION_UNRESOLVED", detail: "This shared tenant has no exact body-to-government binding for the public native body." })),
    sourceReceipt: { contractVersion: 1 as const, reviewedAt: now, reviewedBy: "legistar-members/1",
      sources: raw.readings.map(reading => ({ requestedUrl: reading.url, finalUrl: reading.url, publisher: parent.publishingOrg,
        sourceClass: "OFFICIAL_PUBLISHER" as const, httpStatus: 200, retrievedAt: reading.retrievedAt,
        rawHash: createHash("sha256").update(reading.text).digest("hex"), reviewOutcome: "SUPPORTED" as const,
        reviewedEvidence: "Complete native-id paging; exact tenant-scoped body and person keys join office records and published term dates." })) },
    payload: { ...prior.payload, registry: { ...prior.payload.registry, divisions: [], bodies }, bodyRosters: rosters,
      rosterReaderDispositions: projections.flatMap(projection => projection.dispositions), statewideExecutives: [],
      officialCandidacies: { ...prior.payload.officialCandidacies, rows: candidacies }, officialPhotos: { photos: [] }, rosterPhotos: {} } };
}

export async function publishLegistarMembers(input: { store: RoutineDataStore; raw: LegistarMembers; rows: readonly BodySourceWiring[]; now: string; prior?: RegistryRuntimePrior }) {
  const prior = input.prior ?? await readRegistryRuntimePrior(input.store, input.now);
  if (!prior) throw new Error("LEGISTAR_MEMBERS_PRIOR_MISSING");
  const prepared = legistarMembersPackage(input.raw, input.rows, prior, input.now);
  const candidate = registryRuntimeCandidate(prepared, { prior });
  const published = await processRegisteredManualCandidate(input.store, "registry-runtime-bindings", candidate, input.now, prior.versionId);
  if (!published.promoted) throw new Error(`LEGISTAR_MEMBERS_PUBLICATION_HELD:${published.candidate.failureDetail ?? published.candidate.state}`);
  const next = acceptedRegistryPrior(published);
  for (const roster of prepared.payload.bodyRosters) {
    const read = next.payload.bodyRosters.find(row => row.bodyId === roster.bodyId);
    if (!read || roster.members.some(member => !read.members.some(row => row.id === member.id && row.termStart === member.termStart && row.termEnd === member.termEnd))) throw new Error("LEGISTAR_MEMBERS_READBACK_FAILED");
  }
  const old = new Map(prior.payload.bodyRosters.flatMap(roster => roster.members.map(member => [member.id, member] as const)));
  const changed = prepared.payload.bodyRosters.flatMap(roster => roster.members).filter(member => {
    const before = old.get(member.id);
    return !before || ["name", "officeTitle", "termStart", "termEnd"].some(key => before[key as keyof typeof before] !== member[key as keyof typeof member]);
  }).length;
  return { published, prior: next, changed, unbound: prepared.excludedFacts, members: prepared.payload.bodyRosters.reduce((count, roster) => count + roster.members.length, 0), bodies: prepared.payload.bodyRosters.length };
}
