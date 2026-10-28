import { fixturePlaceMapQuery } from "./place-map.ts";
import { installPlaceMapQuery } from "../../lib/place-map/reader.ts";
installPlaceMapQuery(fixturePlaceMapQuery());

import { currentReaderAuthorityEdge, withReaderAuthorityEdge } from "../../lib/registry/runtime-edge.ts";
import type { RegistryRuntimeReadModel } from "../../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./promoted-fixtures.ts";
import { registryJurisdictions } from "../../lib/civic-data/state-scopes.ts";
import { installPromotedValue } from "./promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../../lib/civic-data/state-scopes.ts";
import { installFactReader } from "../../lib/facts/db.ts";
import { rosterFactReader } from "./roster-fact-reader.ts";
import type { CivicDataReadResult } from "../../lib/civic-data/read-model.ts";
import { readRegistryRuntimeProjection } from "../../lib/registry/runtime-read-model.ts";


function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

async function installRegistryRuntime(states?: readonly string[]): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const selected = states ?? [...new Set(projection.payload.registry.divisions.flatMap(row => registryJurisdictions(row.ocdId)))];
  for (const state of selected) installPromotedValue({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state),
    sourceId: projection.sourceId, versionId: `${projection.versionId}:${state}`, value: registryFixtureForState(state) });
  installFactReader(rosterFactReader(projection.payload.bodyRosters));
  const value = served(await readRegistryRuntimeProjection(selected), "Registry runtime");
  return { value, versionId: selected.map(state => `${projection.versionId}:${state}`).join("|") };
}



await installRegistryRuntime();

const edge = currentReaderAuthorityEdge();
type Listener = (...args: unknown[]) => void;
for (const method of ["on", "once", "addListener", "prependListener", "prependOnceListener"] as const) {
  const original = process[method].bind(process) as (event: string | symbol, listener: Listener) => NodeJS.Process;
  (process as unknown as Record<string, unknown>)[method] = (event: string | symbol, listener: Listener) =>
    original(event, event === "message" ? (...args: unknown[]) => withReaderAuthorityEdge(edge, () => listener(...args)) : listener);
}
