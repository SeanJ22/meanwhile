/** Bring already acquired evidence copies through the current tribal/identity
 * importer without downloading unrelated district polygons again. */
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { acquireStateBoundaries } from "../lib/place-map/acquire.ts";
import { currentGrfPlaceEdges } from "../lib/place-map/grf-edges.ts";
import { buildStatePlaceMap } from "../lib/place-map/build.ts";
import { readLegacyStateMemberships } from "../lib/place-map/refresh.ts";
import { statePostalLinks } from "../lib/place-map/postal-links.ts";
import type { StatePlaceMap } from "../lib/place-map/load.ts";

const metadataOnly = process.argv.includes("--metadata-only");
for (const state of process.argv.slice(2).filter(arg => !arg.startsWith("--"))) {
  if (!/^[A-Z]{2}$/.test(state) || state === "NJ" && !metadataOnly) throw new Error("New Jersey requires fresh school polygons");
  const path = `/tmp/rb-a2-replay/${state.toLowerCase()}-map.json.gz`;
  const held = JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as StatePlaceMap;
  const { reference: registration } = loadRegistrationReference(process.cwd(), state);
  const legacy = await readLegacyStateMemberships(process.cwd(), state);
  const options = { cache: { store: new DurableEvidenceStore("/tmp/rb-a2-replay/sources", { remote: null }), locks: memoryLockManager() }, releases: new Map() };
  const shapes = metadataOnly ? { places: [], boundaries: [] } : await acquireStateBoundaries(registration, { ...options, onlyLayers: new Set(["aiannh"]) }, [...legacy.values()].flatMap(e => [...e.ids, ...e.fringe ?? []]));
  const fips = registration.divisions.find(d => d[1] === "state")![2];
  const tribal = new Set(shapes.places.map(p => p.id));
  const edges = metadataOnly ? [] : (await currentGrfPlaceEdges(fips, [...held.places, ...shapes.places], options)).filter(e => tribal.has(e.placeId));
  const crossStateZctas = new Set(held.zctaEdges.filter(e => e.boundaryYear === 2026 && e.share === null && e.partial).map(e => e.code));
  const update = buildStatePlaceMap({ registration, scopes: [], legacyZips: legacy, legacyZctas: new Set(held.zctaEdges.map(e => e.code)),
    boundaries: [...held.boundaries, ...shapes.boundaries], additionalPlaces: [...held.places, ...shapes.places], acquiredEdges: [...held.zctaEdges, ...edges],
    postalLinks: await statePostalLinks(process.cwd(), state), crossStateZctas, checkedAt: new Date().toISOString() });
  const places = new Map(held.places.map(p => [p.id, p]));
  for (const place of update.places) {
    const previous = places.get(place.id);
    places.set(place.id, { ...place, aliases: [...new Map([...previous?.aliases ?? [], ...place.aliases].filter(a => a.scheme !== "boundary-feature").map(a => [`${a.scheme}|${a.value}`, a])).values()] });
  }
  const unique = <T,>(rows: readonly T[], key: (row: T) => string): T[] => [...new Map(rows.map(row => [key(row), row])).values()];
  const map: StatePlaceMap = { places: [...places.values()], boundaries: update.boundaries,
    zipEdges: unique([...held.zipEdges, ...update.zipEdges], e => `${e.code}|${e.placeId}|${e.boundaryYear}`),
    zctaEdges: unique([...held.zctaEdges, ...update.zctaEdges], e => `${e.code}|${e.placeId}|${e.boundaryYear}`),
    entityPlaces: unique([...held.entityPlaces ?? [], ...update.entityPlaces ?? []], e => `${e.entityId}|${e.placeId}|${e.boundaryYear}`) };
  await writeFile(path, gzipSync(JSON.stringify(map)));
  console.log(`${state}: ${shapes.places.length} tribal places; ${edges.length} measured tribal memberships; copy updated`);
}
