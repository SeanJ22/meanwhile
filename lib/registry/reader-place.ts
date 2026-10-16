import { factReader } from "../facts/db.ts";
import { currentReaderSelection, withReaderSelection } from "../db/reader-route.ts";
import { readPlacePointerSlice, readPlaceVersionSlice } from "../civic-data/held-place-slices.ts";
import type { ReaderAuthorityManifest } from "../meetings/edge-artifacts.ts";
import { ensureReaderAuthorityEdge } from "../meetings/edge-serving.ts";
import { currentRegistryRuntimeEdge, currentCommentAccessEdge, refuseDatabaseInEdgeOnlyContext } from "./runtime-edge.ts";
import { REGISTRY_RUNTIME_SCOPE, type RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import { currentRegistryPlaceRead, type RegistryPlaceRead } from "./runtime-read-model.ts";

function selectedRegistry(value: RegistryRuntimeReadModel, ids: readonly string[], targets: readonly string[]): RegistryRuntimeReadModel {
  const selected = new Set(ids), wanted = new Set(targets);
  const targetBodies = new Set((value.bodyRosters ?? []).filter(roster => roster.members.some(member => wanted.has(member.id) || Boolean(member.personId && wanted.has(member.personId)))).map(roster => roster.bodyId));
  const bodies = value.registry.bodies.filter(body => (body.ocdId && selected.has(body.ocdId)) ||
    body.alsoServesOcdIds?.some(id => selected.has(id)) || wanted.has(body.id) || targetBodies.has(body.id));
  const bodyIds = new Set(bodies.map(body => body.id));
  const rosters = (value.bodyRosters ?? []).filter(roster => bodyIds.has(roster.bodyId));
  const officialCandidacies = (value.officialCandidacies?.rows ?? []).filter(row => row.holder.divisions.some(id => selected.has(id)) ||
    wanted.has(row.holder.id) || Boolean(row.candidacy && wanted.has(row.candidacy.candidacyId)));
  const statewideExecutives = value.statewideExecutives.filter(row => selected.has(row.stateOcdId) || wanted.has(row.holder.id));
  const holderIds = new Set([...wanted, ...statewideExecutives.map(row => row.holder.id), ...officialCandidacies.map(row => row.holder.id), ...rosters.flatMap(roster => roster.members.map(member => member.id))]);
  return { ...value, registry: { ...value.registry, divisions: value.registry.divisions.filter(row => selected.has(row.ocdId)), bodies },
    statewideExecutives,
    officialCandidacies: { ...value.officialCandidacies, rows: officialCandidacies }, bodyRosters: rosters,
    rosterReaderDispositions: (value.rosterReaderDispositions ?? []).filter(row => wanted.has(row.sourceId) || holderIds.has(row.sourceId) || Boolean(row.canonicalId && holderIds.has(row.canonicalId))),
    officialPhotos: { photos: (value.officialPhotos?.photos ?? []).filter(row => holderIds.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos ?? {}).filter(([id]) => holderIds.has(id))) };
}

export async function readRegistryPlace(divisions: readonly string[], targets: readonly string[] = [], manifest?: ReaderAuthorityManifest | null): Promise<RegistryPlaceRead> {
  const ids = [...new Set(divisions.flatMap(id => {
    const state = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}/.exec(id)?.[0];
    return state ? [id, state] : [id];
  }))].sort();
  const requested = [...new Set(targets)].sort();
  const selectorKey = JSON.stringify([ids, requested]);
  const version = manifest?.authorityArtifacts?.["registry-runtime"]?.version.split("+")[0];
  const existing = currentRegistryPlaceRead();
  if (existing?.selectorKey === selectorKey && (!version || existing.versionId.split("+")[0] === version)) return existing;
  const edge = currentRegistryRuntimeEdge();
  if (edge && (!version || edge.versionId.split("+")[0] === version))
    return { source: "EDGE", commentAccess: currentCommentAccessEdge() ?? undefined,
      value: selectedRegistry(edge.value, ids, requested), versionId: edge.versionId, selectorKey };
  if (manifest?.authorityArtifacts?.["registry-runtime"]) {
    const selection = { keys: new Set([...ids, ...requested]) };
    const selected = await withReaderSelection(selection, () => ensureReaderAuthorityEdge(manifest, undefined, ["registry-runtime"])).catch(() => null);
    if (selected?.registryRuntime) {
      for (const key of selection.keys) currentReaderSelection()?.keys.add(key);
      return { source: "EDGE", commentAccess: selected.commentAccess,
        value: selectedRegistry(selected.registryRuntime.value, ids, requested), versionId: selected.registryRuntime.versionId, selectorKey };
    }
  }
  refuseDatabaseInEdgeOnlyContext("The selected registry place");
  const bodyIds = new Set(requested);
  for (const target of requested) {
    const body = /^roster:(.+)#[^#]+$/.exec(target)?.[1];
    if (body) bodyIds.add(body);
  }
  const query = factReader();
  if (query && requested.length) {
    const bodies = await query(`WITH people AS (SELECT id FROM entity WHERE id=ANY($1::text[])
      UNION SELECT entity_id FROM entity_external_id WHERE scheme='roster-member' AND value=ANY($1::text[]))
      SELECT DISTINCT substr(f.field, 8) AS body_id FROM fact f JOIN people p ON p.id=f.entity_id
      WHERE f.status='live' AND f.field LIKE 'office:%'`, [requested]);
    for (const row of bodies) if (typeof row.body_id === "string") bodyIds.add(row.body_id);
  }
  const read = version
    ? await readPlaceVersionSlice<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, version, ids, [...bodyIds], requested)
    : await readPlacePointerSlice<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, ids, [...bodyIds], requested);
  if (read.kind !== "PROMOTED" || !read.value || !read.metadata.versionId) throw new Error(`Registry place holding is ${read.kind}`);
  const value = read.value;
  return { source: "DATABASE", versionId: read.metadata.versionId, selectorKey, value: { ...value, formatVersion: 1,
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: value.officialCandidacies?.rows ?? [] },
    officialPhotos: value.officialPhotos ?? { photos: [] }, rosterPhotos: value.rosterPhotos ?? {},
    bodyRosters: value.bodyRosters ?? [], rosterReaderDispositions: value.rosterReaderDispositions ?? [] } };
}
