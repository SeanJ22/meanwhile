/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
/**
 * `pnpm zcta:outlines` — the ZCTA polygons behind the current-zip shading
 * (g4 item 4, the author's ask: "the reader must be able to see which zip
 * they are looking at").
 *
 * ## What this geometry is, and the warning that comes with it
 *
 * The same warning `scripts/fetch-state-outlines.mts` carries, for the same
 * reason and it is worth repeating rather than cross-referencing: **this
 * geometry never answers a question.** It decides which pixels are tinted and
 * nothing else. A ZCTA is a statistical shape derived from mail delivery
 * routes; it crosses city, county, school district and legislative lines, and
 * `CLAUDE.md`'s entry-experience rule is explicit that a zip can never resolve
 * a ballot. Nothing is joined against these polygons, no district is derived
 * from them, and no claim is made from them. They are orientation, exactly
 * like the centroid the map already flies to.
 *
 * That is what makes the generalization safe. `maxAllowableOffset` of 0.002°
 * is roughly 200 m, which a reader cannot distinguish from the edge of a soft
 * tint — and it is the difference between a file that ships and one that does
 * not. If a later feature ever wants to ASK this geometry something, it needs
 * the unsimplified boundary and this paragraph is the warning.
 *
 * ## Per state, because the map only ever draws one
 *
 * Written as `data/zcta/zcta-<statefp>.json`, one file per covered state,
 * because
 * g4 item 3 made the whole map per-state: only the ACTIVE state's overlays
 * are ever fetched or drawn. A national ZCTA file would be ~40 MB and the
 * reader would download all of it to tint one polygon.
 *
 * Which zips belong to which state is decided by testing each committed ZCTA
 * centroid against the committed state outline — the same point-in-polygon
 * the map itself uses, so the split can never disagree with what the map
 * considers "this state".
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stamp } from "./stamp.mts";
import { pointInRings } from "../lib/geo/polygon.ts";

const SOURCE_ORG = "U.S. Census Bureau";
const SERVICE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/" +
  "PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";

/** Roughly 200 m. Stated, not tuned by eye — see the header. */
const MAX_ALLOWABLE_OFFSET = 0.002;

/**
 * How many zips go in one `GEOID IN (...)` clause.
 *
 * TIGERweb caps a response at 100,000 records but the URL is the real limit;
 * 120 five-digit codes is a ~1 KB query string, comfortably inside every
 * proxy's line limit. Batches are serialized, never parallel — the
 * public-records rule's rate discipline applies to a build script exactly as
 * it applies to an adapter.
 */
const BATCH = 120;

const geoDir = join(process.cwd(), "public", "geo");
const outDir = join(process.cwd(), "data", "zcta");

const outlines = JSON.parse(
  readFileSync(join(geoDir, "state-outlines.geojson"), "utf8"),
) as {
  features: Array<{
    properties: { statefp: string; name: string };
    geometry: { coordinates: number[][][] };
  }>;
};

const centroids = (
  JSON.parse(
    readFileSync(join(process.cwd(), "lib", "geo", "zcta-centroids.json"), "utf8"),
  ) as { centroids: Record<string, [number, number]> }
).centroids;

/** NH79: the repo's one even-odd implementation. See lib/geo/polygon.ts. */
const pointInPolygon = (x: number, y: number, rings: number[][][]): boolean =>
  pointInRings(x, y, rings);

/** zips per state FIPS, decided by the map's own point-in-polygon. */
const byState = new Map<string, string[]>();
for (const [zip, [lat, lng]] of Object.entries(centroids)) {
  for (const feature of outlines.features) {
    if (pointInPolygon(lng, lat, feature.geometry.coordinates)) {
      const list = byState.get(feature.properties.statefp) ?? [];
      list.push(zip);
      byState.set(feature.properties.statefp, list);
      break;
    }
  }
}

mkdirSync(outDir, { recursive: true });

for (const [statefp, zips] of [...byState].sort()) {
  zips.sort();
  const features: unknown[] = [];

  for (let i = 0; i < zips.length; i += BATCH) {
    const batch = zips.slice(i, i + BATCH);
    const where = `GEOID IN (${batch.map((z) => `'${z}'`).join(",")})`;
    const url =
      `${SERVICE}?where=${encodeURIComponent(where)}` +
      `&outFields=GEOID&returnGeometry=true&geometryPrecision=4` +
      `&maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}&outSR=4326&f=geojson`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
            "we-the-people civic map (zcta outlines; contact seanj22@gmail.com)",
      },
    });
    if (!response.ok) {
      throw new Error(
        `TIGERweb answered ${response.status} for ZCTA batch ${i / BATCH} of state ${statefp}`,
      );
    }
    const raw = (await response.json()) as {
      features?: Array<{
        properties: { GEOID: string };
        geometry: { type: string; coordinates: unknown };
      }>;
    };
    const got = raw.features ?? [];

    // An operation that can return nothing is asked what it returned. A
    // batch that matched nothing is a real answer only if the zips in it do
    // not exist as ZCTAs — which is possible (a point ZIP with no area) — so
    // this reports rather than throws, and the totals below are the gate.
    console.log(
      `  state ${statefp} batch ${i / BATCH}: asked ${batch.length}, got ${got.length}`,
    );

    for (const f of got) {
      features.push({
        type: "Feature",
        properties: { zip: f.properties.GEOID },
        geometry: f.geometry,
      });
    }
  }

  if (features.length === 0) {
    throw new Error(
      `state ${statefp}: asked ${zips.length} zips and got 0 polygons — ` +
        "refusing to write an empty file over a populated one",
    );
  }

  const out = {
    type: "FeatureCollection" as const,
    source: SERVICE,
    sourceOrg: SOURCE_ORG,
    collectedAt: stamp(),
    note:
      `Generalized at maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}° for the ` +
      "current-zip shading. NOT district truth and never resolved against — " +
      "see scripts/fetch-zcta-outlines.mts.",
    features,
  };

  const path = join(outDir, `zcta-${statefp}.json`);
  writeFileSync(path, JSON.stringify(out) + "\n", "utf8");
  console.log(
    `state ${statefp}: ${features.length} of ${zips.length} zips → ${path} ` +
      `(${Math.round(JSON.stringify(out).length / 1024)} KB)`,
  );
}
