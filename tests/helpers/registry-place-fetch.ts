import assert from "node:assert/strict";
import type { RegistryRuntimeReadModel } from "../../lib/registry/runtime-data-plane.ts";

export interface FixtureStatement { query?: string; params?: unknown[] }

export function registryPlaceFixtureResult(statement: FixtureStatement, registry: RegistryRuntimeReadModel, version: string) {
  if (statement.params?.[0] !== "REGISTRY_RUNTIME_BINDING" || !statement.query?.includes("WITH selected AS")) return null;
  const array = (value: unknown): string[] => Array.isArray(value) ? value : JSON.parse(`[${String(value).slice(1, -1)}]`);
  const ids = new Set(array(statement.params[2])), targets = new Set(array(statement.params[4]));
  assert.ok(ids.size > 0, "registry reads require an explicit place");
  const states = new Set([...ids].flatMap(id => /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1] ?? []));
  assert.equal(states.size, 1, "these ZIP fixtures select only their own state");
  const accepted = statement.params[6] === undefined ? null : JSON.parse(String(statement.params[6]));
  if (accepted) assert.equal(Object.values(accepted)[0], version);
  const officialCandidacies = registry.officialCandidacies.rows.filter(row => row.holder.divisions.some(id => ids.has(id)) || targets.has(row.holder.id));
  const statewideExecutives = registry.statewideExecutives.filter(row => ids.has(row.stateOcdId) || targets.has(row.holder.id));
  const holders = new Set([...targets, ...officialCandidacies.map(row => row.holder.id), ...statewideExecutives.map(row => row.holder.id)]);
  const value = { ...registry, registry: { ...registry.registry,
    divisions: registry.registry.divisions.filter(row => ids.has(row.ocdId)),
    bodies: registry.registry.bodies.filter(row => row.ocdId && ids.has(row.ocdId) || row.alsoServesOcdIds?.some(id => ids.has(id))) },
    officialCandidacies: { ...registry.officialCandidacies, rows: officialCandidacies }, statewideExecutives,
    officialPhotos: { photos: registry.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(registry.rosterPhotos).filter(([id]) => holders.has(id))), bodyRosters: [], rosterReaderDispositions: [] };
  return { command: "SELECT", rowCount: 1, rowAsArray: true,
    fields: [{ name: "scope", dataTypeID: 25 }, { name: "current_version_id", dataTypeID: 25 },
      { name: "value", dataTypeID: 3802 }, { name: "encoded", dataTypeID: 16 }],
    rows: [[array(statement.params[1])[0], version, JSON.stringify(value), false]] };
}
