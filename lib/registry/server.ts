import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  indexByDivision,
  type OfficeholderIndex,
  type PhotoIndex,
  type SeatHolder,
} from "../officials/lookup.ts";
import type { OfficeholderSet } from "../officials/types.ts";

import { summarizeCoverage, type CoverageSummary } from "./coverage.ts";
import { divisionsAt as resolveDivisionsAt, type GeoFeature } from "./resolve.ts";
import type { Division, Registry } from "./types.ts";

/**
 * Server-side access to the registry and the geometry it resolves against.
 *
 * Both are read from disk once per process and cached. They are static build
 * outputs — the boundary files and `registry.json` are committed exactly like
 * the ZCTA centroids — so nothing here needs a database, which matters because
 * `lib/db/schema.ts` is still `export {}`.
 *
 * **This does not scale, and it is not meant to.** 1.9 MB of GeoJSON parsed into
 * server memory is fine for three counties and untenable for the 90,837 local
 * governments Phase 4.7 targets. That phase replaces it with PMTiles plus a real
 * table. The seam is deliberately narrow — one `coverageAt()` call — so swapping
 * the backing store does not reach into the route or the UI.
 */

interface Loaded {
  features: GeoFeature[];
  divisionsById: Map<string, Division>;
  registry: Registry;
  officials: OfficeholderIndex;
}

/**
 * The generated officeholder rosters, by scope.
 *
 * The federal roster plus one file per state, named by FIPS — 04 Arizona, 33
 * New Hampshire, 34 New Jersey. Adding a state is adding a file and a line
 * here, rather than regenerating everything.
 */
const ROSTERS = [
  "officeholders-us.json",
  "officeholders-04.json",
  "officeholders-33.json",
  "officeholders-34.json",
];

let cache: Promise<Loaded> | null = null;

async function load(): Promise<Loaded> {
  const root = process.cwd();
  const geoDir = join(root, "public", "geo");

  const names = (await readdir(geoDir)).filter((n) => n.endsWith(".geojson"));
  const features: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(geoDir, name), "utf8"));
    features.push(...(parsed.features as GeoFeature[]));
  }

  const registry = JSON.parse(
    await readFile(join(root, "lib", "registry", "registry.json"), "utf8"),
  ) as Registry;

  // A missing or unreadable roster degrades to no names rather than failing the
  // whole coverage answer. The pre-roster copy is still true — it just says
  // less — whereas a 500 here would take the map's only data dependency down
  // over a file that is nice to have.
  const sets: OfficeholderSet[] = [];
  for (const name of ROSTERS) {
    try {
      sets.push(
        JSON.parse(
          await readFile(join(root, "lib", "registry", name), "utf8"),
        ) as OfficeholderSet,
      );
    } catch (error) {
      console.error(`officeholder roster ${name} could not be read`, error);
    }
  }

  // The photo manifest (D20): per-image source and license, images served
  // from our origin. Missing or unreadable degrades to initials everywhere.
  const photos: PhotoIndex = new Map();
  try {
    const manifest = JSON.parse(
      await readFile(
        join(root, "lib", "registry", "official-photos.json"),
        "utf8",
      ),
    ) as { photos: { officeholderId: string; url: string; license: string | null }[] };
    for (const photo of manifest.photos) {
      // Unknown license is not clearable — such a photo never ships (D20).
      if (photo.license) photos.set(photo.officeholderId, photo.url);
    }
  } catch {
    // No manifest is a fine state: initials render instead.
  }

  return {
    features,
    divisionsById: new Map(registry.divisions.map((d) => [d.ocdId, d])),
    registry,
    officials: indexByDivision(sets, photos),
  };
}

function loaded(): Promise<Loaded> {
  // Cache the promise, not the result: two concurrent requests during a cold
  // start would otherwise both parse 1.9 MB of GeoJSON.
  cache ??= load().catch((error) => {
    // A failed load must not poison the cache — the next request should retry
    // rather than inherit the failure for the life of the process.
    cache = null;
    throw error;
  });
  return cache;
}

/**
 * Who governs this point, and how much of their calendar we actually have.
 *
 * `meetingCount` is the cascade's answer for the same point. It is what
 * separates "nothing is scheduled" from "we cannot see what is scheduled", and
 * those must never render the same way.
 */
/** The divisions containing a point, from the committed geometry. */
export async function divisionsAt(lat: number, lng: number): Promise<Division[]> {
  const { features, divisionsById } = await loaded();
  return resolveDivisionsAt([lng, lat], features, divisionsById);
}

/**
 * One officeholder by roster id, in the render shape (4, 2026-08-19).
 * Serves the ballot page's incumbent-record link: the id arrives from an
 * exact-key join (never a name match), and an id the roster doesn't hold
 * returns null — no link rather than a wrong one.
 */
export async function seatHolderById(id: string): Promise<SeatHolder | null> {
  const { officials } = await loaded();
  for (const holders of officials.values()) {
    for (const holder of holders) {
      if (holder.id === id) return holder;
    }
  }
  return null;
}

export async function coverageAt(
  lat: number,
  lng: number,
  meetingCount: number,
): Promise<CoverageSummary> {
  const { features, divisionsById, registry, officials } = await loaded();
  return summarizeCoverage(
    [lng, lat],
    features,
    divisionsById,
    registry.bodies,
    meetingCount,
    officials,
  );
}
