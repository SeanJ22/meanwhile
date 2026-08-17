/**
 * The two universes for a zip, enumerated against an OUTSIDE denominator.
 *
 *   pnpm zip:universe 03255
 *
 * ## What this is for
 *
 * CLAUDE.md: coverage claims are made against the official universe, never
 * against our own records. `scripts/census-who-governs.mts` answers "of the
 * bodies we KNOW govern this point, how many do we read?" — its denominator
 * is the registry, so it can never catch a body nobody has heard of. This
 * script answers the question one layer out: **what exists**, per the Census
 * of Governments, and which of those things actually touch this zip.
 *
 * ## Two universes, kept mechanically apart
 *
 * A body can be in either, both, or neither, and conflating them is the trap
 * this file exists to prevent:
 *
 * - `governsZip` — its jurisdiction contains the zip. This is the who-governs
 *   card's denominator.
 * - `meetingsNearZip` — it sits and a reader at this zip would see the pin.
 *   This is the map's denominator.
 *
 * A neighbouring town's Selectboard is the standing example: New London's
 * board meets 12 km from Newbury, so a reader sees it — but it does not
 * govern one inch of Newbury, and sharing a regional school district does not
 * change that. The regional district governs; the neighbour's own boards do
 * not. Proximity is never allowed to imply jurisdiction here.
 *
 * ## How each flag is decided, and why the method is recorded per row
 *
 * `governsZip` is decided by GEOMETRY where the Census publishes a boundary —
 * the zip's ZCTA centroid tested against the committed TIGER layers. Special
 * districts have no Census boundary at ANY vintage, so geometry cannot answer
 * for them: they resolve to `UNRESOLVED` until a hunt reads the district's own
 * published territory. `UNRESOLVED` is a work item, never a `false`. Recording
 * a district as "does not govern" because we could not find its boundary is
 * exactly the manufactured claim the render-default rule forbids, one layer
 * upstream.
 *
 * `meetingsNearZip` is decided against the product's own serving rule — the
 * first rung of `RADIUS_LADDER_KM`, 25 km — measured from the zip's ZCTA
 * centroid. Where the body's actual meeting venue is known it is measured
 * from that; otherwise from the administrative address the Census itself
 * publishes for the unit, which is a PROXY and is labelled one on the row. A
 * proxy that is not labelled is a claim.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { haversineKm } from "../lib/geo/distance.ts";
import { RADIUS_LADDER_KM } from "../lib/meetings/constants.ts";
import { lookupZcta, resolveZip } from "../lib/geo/zcta.ts";

const GUS = "data/audit/gus-2022-merrimack-sullivan-hillsborough.json";
const GEO = (layer: string) => `public/geo/${layer}.geojson`;

type GusRow = {
  kind: string;
  censusId: string;
  name: string;
  unitType?: string;
  web: string;
  city: string;
  active: string;
  countyFips: string;
  zip?: string;
};

type Ring = number[][];

function ringsOf(geom: { type: string; coordinates: unknown }): Ring[] {
  const out: Ring[] = [];
  if (geom.type === "Polygon") out.push(...(geom.coordinates as Ring[]));
  else if (geom.type === "MultiPolygon")
    for (const poly of geom.coordinates as Ring[][]) out.push(...poly);
  return out;
}

/** Even-odd point-in-polygon over every ring, holes included. */
function contains(point: [number, number], geom: { type: string; coordinates: unknown }): boolean {
  let inside = false;
  for (const ring of ringsOf(geom)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Shortest great-circle distance from a point to any vertex of a shape. */
function nearestVertexKm(lat: number, lng: number, geom: { type: string; coordinates: unknown }): number {
  let best = Infinity;
  for (const ring of ringsOf(geom)) {
    for (const [x, y] of ring) {
      const d = haversineKm(lat, lng, y, x);
      if (d < best) best = d;
    }
  }
  return best;
}

function loadLayer(name: string) {
  return JSON.parse(readFileSync(GEO(name), "utf8")) as {
    features: { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }[];
  };
}

/** Normalises a Census unit name to a comparable town/district token. */
function normalize(s: string): string {
  return s
    .toUpperCase()
    .replace(/^(TOWN|CITY|COUNTY|TOWNSHIP) OF /, "")
    .replace(/\b(TOWN|CITY|TOWNSHIP|SCH|SCHOOL|DIST|DISTRICT|REG|REGIONAL|COUNTY)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

async function main() {
  const zip = (process.argv[2] ?? "03255").trim();
  const resolved = resolveZip(zip);
  if (!resolved.ok) throw new Error(`${zip} did not resolve: ${resolved.reason}`);
  const { lat, lng } = resolved.centroid;
  const point: [number, number] = [lng, lat];
  const nearKm = RADIUS_LADDER_KM[0];

  const gus = JSON.parse(readFileSync(GUS, "utf8")) as Record<string, GusRow[] | string>;
  const counties = Object.keys(gus).filter((k) => !k.startsWith("_"));

  const cousub = loadLayer("cousub-33");
  const county = loadLayer("county-us");
  const school = [...loadLayer("unsd-33").features, ...loadLayer("elsd-33").features, ...loadLayer("scsd-33").features];

  // Which named geometries actually contain the point. These are the ground
  // truth the name-matching below is checked against.
  const govCousub = cousub.features.filter((f) => contains(point, f.geometry));
  const govCounty = county.features.filter((f) => contains(point, f.geometry));
  const govSchool = school.filter((f) => contains(point, f.geometry));

  console.log(`## ${zip} — centroid ${lat}, ${lng}`);
  console.log(`meetings-near rule: RADIUS_LADDER_KM[0] = ${nearKm} km from the ZCTA centroid\n`);
  console.log("geometry says the point is inside:");
  for (const f of [...govCounty, ...govCousub, ...govSchool]) {
    console.log(`  ${f.properties.label}  (${f.properties.ocdId})`);
  }

  const rows: Record<string, unknown>[] = [];

  for (const fips of counties) {
    for (const unit of gus[fips] as GusRow[]) {
      const token = normalize(unit.name);
      let governs: boolean | "UNRESOLVED" = false;
      let governsMethod = "";
      let geographyServed = "";
      let ocdId: string | null = null;

      if (unit.kind === "GENERAL_PURPOSE" && /COUNTY/.test(unit.unitType ?? "")) {
        const hit = govCounty.find((f) => normalize(f.properties.label) === token);
        governs = Boolean(hit);
        ocdId = hit?.properties.ocdId ?? null;
        governsMethod = "TIGER county polygon contains the ZCTA centroid";
        geographyServed = "the whole county";
      } else if (unit.kind === "GENERAL_PURPOSE") {
        const hit = govCousub.find((f) => normalize(f.properties.label) === token);
        governs = Boolean(hit);
        ocdId = hit?.properties.ocdId ?? null;
        governsMethod = "TIGER county-subdivision polygon contains the ZCTA centroid";
        geographyServed = "the municipality";
      } else if (unit.kind === "SCHOOL_DISTRICT" || unit.kind === "DEPENDENT_SCHOOL_DISTRICT") {
        const hit = govSchool.find((f) => normalize(f.properties.label) === token);
        governs = Boolean(hit);
        ocdId = hit?.properties.ocdId ?? null;
        governsMethod = "TIGER school-district polygon contains the ZCTA centroid";
        geographyServed = "the school district";
      } else {
        governs = "UNRESOLVED";
        governsMethod =
          "the Census publishes NO boundary for special districts at any vintage — " +
          "resolvable only by reading the district's own published territory";
        geographyServed = "unresolved";
      }

      // TWO distances, because they answer different questions and a single
      // number would smuggle one answer in under the other's name.
      //
      // `boundaryKm` — nearest point of the unit's own territory. GENEROUS:
      // a town whose far corner reaches inside the circle counts, even if it
      // sits forty kilometres away. It is the upper bound on what could
      // possibly show, and over-counting a denominator can only ever make our
      // coverage look worse, never better, which is the safe direction.
      //
      // `adminKm` — the ZCTA centroid of the administrative address the
      // Census itself publishes for the unit. TIGHTER, and closer to the
      // thing a reader actually experiences, because the map pins a meeting
      // at its VENUE. It is a PROXY: a town's mailing address is usually its
      // town hall, and usually is not always.
      //
      // `meetingsNearZip` is decided on the venue proxy where one exists,
      // because that is what puts a pin on screen. Both numbers are carried
      // so the scorecard can state the bound as well as the estimate.
      const adminZip = (unit as { zip?: string }).zip ?? "";
      const adminCentroid = adminZip ? lookupZcta(adminZip) : null;
      const adminKm = adminCentroid ? haversineKm(lat, lng, adminCentroid.lat, adminCentroid.lng) : null;
      let km: number | null = null;
      let nearMethod = "";
      // The distance layer must be the SAME layer the governs test used.
      // Searching county and county-subdivision features together made
      // "TOWN OF MERRIMACK" (Hillsborough County, ~80 km away) match the
      // MERRIMACK COUNTY polygon and report 5.39 km — the normalizer strips
      // the type word, so a town and a county sharing a name collapse into
      // one token. Hillsborough town and Hillsborough County did the same.
      const layer =
        unit.kind === "GENERAL_PURPOSE"
          ? /COUNTY/.test(unit.unitType ?? "")
            ? county.features
            : cousub.features
          : school;
      if (unit.kind === "GENERAL_PURPOSE" || unit.kind === "SCHOOL_DISTRICT") {
        const shape = layer.find((f) => normalize(f.properties.label) === token);
        if (shape) {
          km = nearestVertexKm(lat, lng, shape.geometry);
          nearMethod = "nearest point of the unit's own TIGER boundary";
        }
      }
      const boundaryKm = km;
      const venueKm = adminKm ?? boundaryKm;
      const venueMethod = adminKm !== null
        ? `PROXY — ZCTA centroid of the unit's Census administrative address (${adminZip})`
        : nearMethod;

      rows.push({
        authoritativeSource: "2022 Census of Governments, Government Units Listing",
        sourceVintage: "2022 (January 2022 release), fetched 2026-08-16",
        censusId: unit.censusId,
        name: unit.name,
        governmentType: unit.unitType ?? unit.kind,
        kind: unit.kind,
        countyFips: fips,
        ocdId,
        geographyServed,
        governsZip: governs,
        governsMethod,
        boundaryKm: boundaryKm === null ? null : Number(boundaryKm.toFixed(2)),
        boundaryMethod: nearMethod || "no TIGER boundary published for this unit type",
        venueKm: venueKm === null ? null : Number(venueKm.toFixed(2)),
        venueMethod: venueMethod || "no boundary and no administrative ZIP — undecidable from committed data",
        meetingsNearZip: venueKm === null ? "UNRESOLVED" : venueKm <= nearKm,
        withinBoundaryBound: boundaryKm === null ? "UNRESOLVED" : boundaryKm <= nearKm,
        active: unit.active,
        web: unit.web || null,
      });
    }
  }

  const governing = rows.filter((r) => r.governsZip === true);
  const unresolvedGov = rows.filter((r) => r.governsZip === "UNRESOLVED");
  const near = rows.filter((r) => r.meetingsNearZip === true);
  const unresolvedNear = rows.filter((r) => r.meetingsNearZip === "UNRESOLVED");
  const withinBound = rows.filter((r) => r.withinBoundaryBound === true);

  console.log(`\n## Step B — jurisdiction mapping over ${rows.length} enumerated units`);
  console.log(`governs ${zip}:        ${governing.length} resolved true, ${unresolvedGov.length} UNRESOLVED`);
  console.log(
    `meets within ${nearKm} km:  ${near.length} by venue proxy, ` +
      `${withinBound.length} by the generous territory bound, ${unresolvedNear.length} UNRESOLVED\n`,
  );

  console.log("GOVERNS THIS ZIP:");
  for (const r of governing) console.log(`  ${r.name}  [${r.kind}]  ${r.ocdId ?? ""}`);
  console.log("\nMEETS WITHIN THE DEFAULT RADIUS BY VENUE PROXY (units, not yet bodies):");
  for (const r of [...near].sort((a, b) => (a.venueKm as number) - (b.venueKm as number))) {
    console.log(
      `  ${String(r.venueKm).padStart(6)} km venue / ${String(r.boundaryKm ?? "—").padStart(6)} km territory  ` +
        `${r.name}  [${r.kind}]`,
    );
  }
  console.log("\nGOVERNS UNRESOLVED (special districts — no Census boundary exists at any vintage):");
  for (const r of unresolvedGov) {
    console.log(`  ${String(r.venueKm ?? "—").padStart(6)} km  ${r.name}  (${r.countyFips})`);
  }

  const out = {
    zip,
    frozenAt: new Date().toISOString(),
    centroid: { lat, lng },
    meetingsNearRule: {
      value: nearKm,
      unit: "km",
      source: "lib/meetings/constants.ts RADIUS_LADDER_KM[0]",
      note: "standing product law; the ladder widens to 60 then 150 km only when nothing upcoming is in view",
    },
    stepA: {
      source: "2022 Census of Governments, Government Units Listing",
      file: GUS,
      counties,
      unitsEnumerated: rows.length,
    },
    stepB: {
      governsZipTrue: governing.length,
      governsZipUnresolved: unresolvedGov.length,
      meetingsNearTrueByVenueProxy: near.length,
      meetingsNearTrueByTerritoryBound: withinBound.length,
      meetingsNearUnresolved: unresolvedNear.length,
    },
    units: rows,
  };
  const dest = process.env.UNIVERSE_OUT ?? `data/audit/universe-${zip}.json`;
  writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log(`\nwrote ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
