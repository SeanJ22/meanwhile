import type { BodyFacts } from "../facts/registry-overlay.ts";
import { isDeepStrictEqual } from "node:util";
import type { Provenance } from "../sources/types.ts";
import type { Body } from "./types.ts";
import type { BodyRoster, RosterMember } from "./body-rosters.ts";
import type { RegistryRuntimeCarton, RegistryRuntimeReadModel } from "./runtime-data-plane.ts";

function known<T extends object>(older: T, newer: Partial<T>): T {
  return Object.assign({}, older, Object.fromEntries(Object.entries(newer).filter(([, value]) => value !== null && value !== undefined)));
}

function checkedAt(source: { collectedAt?: string; verifiedAt?: string | null } | undefined): number {
  return Math.max(Date.parse(source?.collectedAt ?? "") || 0, Date.parse(source?.verifiedAt ?? "") || 0);
}

function membership(member: RosterMember, roster: BodyRoster): RosterMember {
  return member.membershipSource ? member : { ...member, membershipSource: {
    sourceUrl: roster.sourceUrl, sourceOrg: roster.sourceOrg, collectedAt: roster.collectedAt,
  } };
}

function memberSource(member: RosterMember, roster: BodyRoster, field: string): Provenance {
  const held = member.fieldSources?.[field] ?? (field === "officeTitle" ? member.fieldSources?.office : undefined);
  if (held) return held;
  if (field === "partyLabel" && member.partySourceUrl && member.partyCollectedAt) return {
    sourceUrl: member.partySourceUrl, sourceOrg: member.partySourceOrg ?? roster.sourceOrg,
    collectedAt: member.partyCollectedAt, verifiedAt: null,
  };
  const source = member.membershipSource ?? roster;
  return { sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg, collectedAt: source.collectedAt,
    ...(roster.kind ? { kind: roster.kind } : {}), verifiedAt: null };
}

function mergeMember(prior: RosterMember, incoming: RosterMember, priorRoster: BodyRoster, incomingRoster: BodyRoster): RosterMember {
  const old = membership(prior, priorRoster), next = membership(incoming, incomingRoster);
  const newer = checkedAt(next.membershipSource) >= checkedAt(old.membershipSource) ? next : old;
  const result = known(newer === next ? old : next, newer);
  const fieldSources = { ...old.fieldSources };
  for (const field of ["name", "officeTitle", "email", "phone", "websiteUrl", "partyLabel", "termNote", "termStart", "termEnd"] as const) {
    const oldSource = memberSource(old, priorRoster, field), nextSource = memberSource(next, incomingRoster, field);
    const useNext = next[field] != null && (old[field] == null || checkedAt(nextSource) >= checkedAt(oldSource));
    const selected = useNext ? next : old;
    Object.assign(result, { [field]: selected[field] });
    if (selected[field] != null) fieldSources[field] = useNext ? nextSource : oldSource;
    if (field === "partyLabel") for (const key of ["partySourceUrl", "partySourceOrg", "partyCollectedAt"] as const) {
      if (selected[key] === undefined) delete result[key]; else result[key] = selected[key];
    }
    if (field === "phone" && selected.phone != null) for (const key of ["contactKind", "contactScope"] as const) {
      if (selected[key] === undefined) delete result[key]; else Object.assign(result, { [key]: selected[key] });
    }
  }
  if (old.nativeIds || next.nativeIds) result.nativeIds = Object.fromEntries([...new Set([
    ...Object.keys(old.nativeIds ?? {}), ...Object.keys(next.nativeIds ?? {}),
  ])].map(key => [key, [...new Set([...(old.nativeIds?.[key] ?? []), ...(next.nativeIds?.[key] ?? [])])]]));
  return { ...result, fieldSources };
}

function mergeRoster(prior: BodyRoster, incoming: BodyRoster): BodyRoster {
  if (isDeepStrictEqual(prior, incoming)) return prior;
  const members = new Map(prior.members.map(member => [member.id, membership(member, prior)]));
  for (const row of incoming.members) {
    const old = members.get(row.id);
    members.set(row.id, old ? mergeMember(old, row, prior, incoming) : membership(row, incoming));
  }
  const newer = checkedAt(incoming) >= checkedAt(prior) ? incoming : prior;
  const older = newer === incoming ? prior : incoming;
  const header = known(older, newer);
  const partisan = newer.partisanship === "UNDETERMINED" ? older : newer;
  return { ...header, ...(partisan.partisanship !== "UNDETERMINED" ? {
    partisanship: partisan.partisanship, partisanshipSourceUrl: partisan.partisanshipSourceUrl,
  } : {}), members: [...members.values()] };
}

function bodySource(body: Partial<Body>, field: string): Provenance | undefined {
  if (body.fieldSources?.[field]) return body.fieldSources[field];
  if (field === "meetingCadence" && body.meetingCadenceSource) return {
    ...body.meetingCadenceSource, sourceOrg: body.provenance?.sourceOrg ?? "", verifiedAt: null,
  };
  return body.provenance;
}

function mergeBody(prior: Body, incoming: Partial<Body>): Body {
  const result = { ...prior }, fieldSources = { ...prior.fieldSources };
  for (const [field, value] of Object.entries(incoming)) {
    if (value == null || ["fieldSources", "provenance", "bodyOrigin", "meetingCadenceSource"].includes(field)) continue;
    const old = prior[field as keyof Body], source = bodySource(incoming, field);
    if (old != null && checkedAt(source) < checkedAt(bodySource(prior, field))) continue;
    Object.assign(result, { [field]: value });
    if (source) fieldSources[field] = source;
    if (field === "name") {
      if (incoming.provenance) result.provenance = incoming.provenance;
      if (incoming.bodyOrigin) result.bodyOrigin = incoming.bodyOrigin;
    }
    if (field === "meetingCadence" && incoming.meetingCadenceSource) result.meetingCadenceSource = incoming.meetingCadenceSource;
  }
  return { ...result, fieldSources };
}

export function withStateRegistryFacts(carton: RegistryRuntimeCarton & Partial<RegistryRuntimeReadModel>, facts: readonly BodyFacts[]): RegistryRuntimeReadModel {
  const rosters = new Map((carton.bodyRosters ?? []).map(roster => [roster.bodyId, roster]));
  const dispositions = new Map((carton.rosterReaderDispositions ?? []).map(row => [row.sourceId, row]));
  const byBody = new Map(facts.map(body => [body.id, body.fields]));
  for (const fact of facts) {
    const prior = rosters.get(fact.id);
    if (fact.roster) rosters.set(fact.id, prior ? mergeRoster(prior, fact.roster) : fact.roster);
    const oldMembers = new Map(prior?.members.map(row => [row.id, row]));
    const newMembers = new Map(fact.roster?.members.map(row => [row.id, row]));
    for (const row of fact.dispositions) {
      const old = oldMembers.get(row.sourceId), next = newMembers.get(row.sourceId);
      if (!dispositions.has(row.sourceId) || (next && checkedAt(next.membershipSource ?? fact.roster!) >= checkedAt(old?.membershipSource ?? prior))) {
        dispositions.set(row.sourceId, row);
      }
    }
  }
  return { ...carton, registry: { ...carton.registry, bodies: carton.registry.bodies.map(body => {
    const fields = byBody.get(body.id);
    return fields ? mergeBody(body, fields) : body;
  }) }, bodyRosters: [...rosters.values()], rosterReaderDispositions: [...dispositions.values()] };
}

export function combineStateRegistries(values: readonly RegistryRuntimeReadModel[]): RegistryRuntimeReadModel {
  if (values.length === 1) return values[0];
  if (!values.length) throw new Error("REGISTRY_STATES_EMPTY");
  const by = <T>(rows: readonly T[], key: (row: T) => string): T[] => [...new Map(rows.map(row => [key(row), row])).values()];
  const rosters = new Map<string, BodyRoster>();
  for (const value of values) for (const roster of value.bodyRosters) {
    const prior = rosters.get(roster.bodyId);
    rosters.set(roster.bodyId, prior ? mergeRoster(prior, roster) : roster);
  }
  return { ...values[0], registry: { generatedAt: values.map(value => value.registry.generatedAt).sort().at(-1)!,
    divisions: by(values.flatMap(value => value.registry.divisions), row => row.ocdId),
    bodies: by(values.flatMap(value => value.registry.bodies), row => row.id) },
    statewideExecutives: by(values.flatMap(value => value.statewideExecutives), row => `${row.stateOcdId}:${row.holder.id}`),
    officialCandidacies: { ...values[0].officialCandidacies, rows: by(values.flatMap(value => value.officialCandidacies.rows), row => row.holder.id) },
    officialPhotos: { photos: by(values.flatMap(value => value.officialPhotos.photos), row => row.officeholderId) },
    rosterPhotos: Object.assign({}, ...values.map(value => value.rosterPhotos)), bodyRosters: [...rosters.values()],
    rosterReaderDispositions: by(values.flatMap(value => value.rosterReaderDispositions), row => row.sourceId) };
}
