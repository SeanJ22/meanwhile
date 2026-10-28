import { readBodyFacts } from "../facts/registry-overlay.ts";
import type { Query } from "../facts/publish.ts";
import { readRegistryPlaceRows } from "../civic-data/keyed-registry-place.ts";
import { compositionFor } from "../registry/body-membership.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { projectBodyDetail, type ReaderBodyDetail } from "./body-detail.ts";

/** Resolve only the requested identities and the small entity metadata behind their field sources. */
export const BODY_IDENTITIES_SQL = `WITH requested AS (SELECT unnest($2::text[]) AS id),
  aliases AS (SELECT requested.id,coalesce((SELECT entity_id FROM entity_external_id
    WHERE scheme='body-alias' AND value=requested.id LIMIT 1),requested.id) AS canonical FROM requested)
  SELECT a.id AS requested,a.canonical,
    ARRAY(SELECT x.value FROM entity_external_id x WHERE x.entity_id=a.canonical AND x.scheme='body-alias') AS aliases,
    CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id',e.id,'name',e.name,'parentId',e.parent_id,
      'parentKind',parent.kind,'parentName',parent.name,
      'hasDivision',EXISTS(SELECT 1 FROM entity_place ep WHERE ep.entity_id=e.id AND ep.place_id LIKE 'ocd-division/%'),
      'hostCounty',EXISTS(SELECT 1 FROM entity_place ep WHERE ep.entity_id=e.id AND ep.placement_basis='HOST_COUNTY')) END AS entity
  FROM aliases a LEFT JOIN entity e ON e.id=a.canonical AND e.kind='body' AND e.state=$1::char(2)
    LEFT JOIN entity parent ON parent.id=e.parent_id`;

export async function readBodyDetail(query: Query, state: string, bodyId: string): Promise<ReaderBodyDetail> {
  const alias = compositionFor(bodyId)?.aliasOfBodyId;
  const ids = [...new Set([bodyId, ...(alias ? [alias] : [])])];
  const identities = [...await query(BODY_IDENTITIES_SQL, [state, ids])];
  const resolved = identities.find(row => row.requested === bodyId)?.canonical;
  const resolvedAlias = typeof resolved === "string" ? compositionFor(resolved)?.aliasOfBodyId : undefined;
  if (resolvedAlias && !ids.includes(resolvedAlias)) identities.push(...await query(BODY_IDENTITIES_SQL, [state, [resolvedAlias]]));
  const canonical = new Map(identities.flatMap(row => [String(row.requested), ...(row.aliases as string[] ?? [])]
    .map(id => [id, String(row.canonical)] as const)));
  const selectedId = canonical.get(bodyId) ?? bodyId;
  const selectedIds = [...new Set(identities.flatMap(row => [String(row.canonical), ...(row.aliases as string[] ?? [])]))];
  const [slice, facts] = await Promise.all([
    readRegistryPlaceRows(query, state, [], { bodyIds: selectedIds }), readBodyFacts(query, selectedIds, true),
  ]);
  const bodies = slice?.payload.registry.bodies.map(body => ({ ...body, id: canonical.get(body.id) ?? body.id })) ?? [];
  const rosters = slice?.payload.bodyRosters.map(roster => ({ ...roster, bodyId: canonical.get(roster.bodyId) ?? roster.bodyId })) ?? [];
  if (!identities.some(row => row.entity) && !bodies.length && !rosters.length && !facts.length) throw new Error("BODY_DETAIL_NOT_FOUND");
  const people = [...rosters.flatMap(roster => [...roster.members, ...roster.membershipHistory ?? []]),
    ...facts.flatMap(fact => fact.roster?.members ?? [])];
  const keys = [...new Set(people.flatMap(person => [...personIdentityKeys(person)]))];
  // Reuse the same validated keyed reader for portraits and dispositions. The
  // second request selects no body or roster rows.
  const selected = keys.length ? await readRegistryPlaceRows(query, state, [], { personIds: keys }) : null;
  const registry: RegistryRuntimeReadModel = { formatVersion: 1, registry: { generatedAt: "", bodies, divisions: [] },
    bodyRosters: rosters, rosterReaderDispositions: selected?.payload.rosterReaderDispositions ?? slice?.payload.rosterReaderDispositions ?? [],
    statewideExecutives: [], officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] },
    officialPhotos: { photos: [...selected?.photos ?? []] }, rosterPhotos: { ...selected?.rosterPhotos } };
  const detail = projectBodyDetail(state, selectedId, registry, facts);
  const entity = identities.find(row => row.canonical === selectedId)?.entity as Record<string, unknown> | null | undefined;
  const fact = facts.find(row => row.id === selectedId), source = fact?.fields.provenance;
  if (!entity || !source || bodies.some(body => body.id === selectedId)) return { ...detail, bodyId };
  const derived = [
    ...(entity.hasDivision || selectedId.startsWith("ocd-division/") ? ["ocdId"] : []),
    ...(entity.parentKind === "government" ? ["governmentId", ...(entity.parentName ? ["governmentName"] : []),
      ...(/^(?:[a-z]{2}:(?:special|school|depschool):|government:US-)/i.test(String(entity.parentId)) ? ["governmentType"] : [])] : []),
    ...(typeof entity.name === "string" && entity.name !== selectedId ? ["registeredName"] : []),
    ...(entity.hostCounty ? ["placementBasis"] : []),
  ];
  return { ...detail, bodyId, fieldSources: { ...Object.fromEntries(derived.map(field => [field, source])), ...detail.fieldSources } };
}
