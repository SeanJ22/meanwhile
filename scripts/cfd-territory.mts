/**
 * `pnpm cfd:territory` — RESOLVE A DISTRICT THAT HAS NO BOUNDARY LAYER, BY
 * READING THE LAND OUT OF ITS FORMATION DOCUMENT. (2026-08-27, the 85641
 * detective session.)
 *
 * ## The problem this exists for
 *
 * `states/az/85641.md` carried two Pima County community facilities districts
 * as LEADS with the reason written down: each has its own district board, each
 * levies, and neither appears in any boundary layer this project has walked.
 * Pima County's own ArcGIS holds 34 services and 281 layers and **not one of
 * them is a community-facilities-district layer**. The standing conclusion was
 * that the territory could not be checked.
 *
 * That was true about boundary layers and false about the world. A CFD is
 * created by a county resolution under A.R.S. 48-701 et seq., and that
 * resolution has to recite the land — by recorded plat, book and page, or by
 * recorder sequence number, because the district's tax attaches to parcels.
 * The county separately publishes its recorded subdivision plats as GIS,
 * for reasons that have nothing to do with districts.
 *
 * So the boundary was published all along, as a PLAT rather than as a
 * boundary, and the route is:
 *
 *   formation resolution  ->  legal description  ->  recorded plat name
 *     ->  the county's own Subdivisions layer  ->  polygon  ->  point test
 *
 * ## What it refuses to do
 *
 * It does not decide that a district governs a ZIP because the district's
 * name sounds local, and it does not accept a name match as a territory. Every
 * answer here is a point inside a recorded plat tested against the Census
 * Bureau's own ZCTA polygon — a third publisher, deliberately, so the county
 * is not both the claim and its own proof.
 *
 * A plat that returns no geometry is reported as a FAILED READ of that plat.
 * Zero matching plats is a FAILED QUERY, never a finding that the district has
 * no land: a district exists because a resolution formed it, and this tool
 * cannot unmake one by not finding its plat.
 *
 * ```
 * pnpm cfd:territory --zip 85641
 * pnpm cfd:territory --zip 85641 --json out.json
 * pnpm cfd:territory --geojson public/geo/body-territories.geojson
 * ```
 */
import { writeFileSync } from "node:fs";

const UA = "WeThePeopleBot/1.0 (+https://wethepeople.vote)";

/**
 * The districts this project has read a formation document for, with the
 * recorded-plat description taken VERBATIM from that document.
 *
 * Adding a district means reading its resolution and adding an entry — never
 * guessing a plat name from the district's name. The `legalDescription` field
 * is the quoted recital and `formationSource` is where it was read.
 */
interface CfdSubject {
  key: string;
  /**
   * The REGISTRY BODY this territory belongs to.
   *
   * Emitting geometry with no body id would produce a polygon nothing can be
   * joined to — the same shape as a meeting with no bodyId. The territory is
   * only useful because it says WHOSE it is.
   */
  bodyId: string;
  name: string;
  /** The county's own subdivision-layer query for the plats the resolution names. */
  platWhere: string;
  legalDescription: string;
  formedOn: string;
  formationInstrument: string;
  formationSource: string;
  /** Who exercises the district's authority, from the resolution itself. */
  governingBoard: string;
}

const SUBJECTS: CfdSubject[] = [
  {
    key: "pima-rocking-k-south-cfd",
    bodyId: "curated:az/pima-rocking-k-south-cfd#governing",
    name: "Rocking K South Community Facilities District",
    platWhere: "UPPER(SUB_NAME) LIKE 'ROCKING K SOUTH%'",
    legalDescription:
      "Blocks 1 through 14 of Rocking K South, a subdivision of Pima County, Arizona, as recorded in Book 64 of Maps and Plats, at Page 85, in the office of the Pima County Recorder. Approximately 2,047 acres, wholly within the unincorporated areas of the County and not within a county island.",
    formedOn: "2017-01-17",
    formationInstrument: "Pima County Resolution No. 2017-2, recorded 2017-02-14 as sequence 20170450755",
    formationSource:
      "https://content.civicplus.com/api/assets/8e51ea97-7725-4a0e-ab70-630811e7c22f",
    governingBoard:
      "the members of the Pima County Board of Supervisors, ex officio (Resolution 2017-2 s.4). The County Administrator serves as District Administrator, the County Treasurer as District Treasurer, and the Clerk of the Board as District Clerk.",
  },
  {
    key: "pima-wildflower-cfd",
    bodyId: "wtp-body/country:us/state:az/wildflower_community_facilities_district#governing",
    name: "Wildflower Community Facilities District",
    platWhere: "SEQ_NUM = '20172440197' OR UPPER(SUB_NAME) LIKE 'WILDFLOWER BLOCKS%'",
    legalDescription:
      "The Final Block Plat for Wildflower Blocks 1-22 and Common Area \"A\" (Natural Open Space and Drainage) and Common Area \"B\" (Enhanced Natural Open Space), Section 18, T15S, R12E, G&SRB&M, Pima County, Arizona, recorded by the Pima County Recorder under sequence No. 20172440197 on September 1, 2017. Approximately 644.6 acres, wholly within unincorporated Pima County and not within a county island.",
    formedOn: "2021-11-16",
    formationInstrument: "Pima County Resolution No. 2021-78",
    formationSource:
      "https://content.civicplus.com/api/assets/az-pimacounty/93c68105-6282-4ba7-9103-568593e5a978",
    governingBoard:
      "the members of the Pima County Board of Supervisors, sitting as the Board of Directors of the District (Resolution 2021-78).",
  },
];

const SUBDIVISIONS =
  "https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/LandRecords/MapServer/15/query";
/** The Census Bureau's own ZCTA polygons — a third publisher, on purpose. */
const ZCTA =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";

interface PlatPoint {
  plat: string;
  sequence: string | null;
  lat: number;
  lon: number;
  zcta: string;
  /** The plat POLYGON, kept so the territory can be emitted (NH233). */
  rings: number[][][];
}

async function getJson(url: string, what: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} — a failed read, not an empty answer`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * A representative interior point for a plat.
 *
 * The ring centroid is used because a recorded subdivision block is convex
 * enough for it, and because the alternative — a vertex — sits ON the boundary
 * and would make a plat that merely touches a ZCTA edge read as inside it.
 */
function ringCentroid(geometry: { rings?: number[][][] }): [number, number] | null {
  const ring = geometry.rings?.[0];
  if (!ring?.length) return null;
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

async function zctaAt(lon: number, lat: number): Promise<string> {
  const q = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "BASENAME",
    returnGeometry: "false",
    f: "json",
  });
  const j = await getJson(`${ZCTA}?${q}`, "TIGERweb ZCTA point query");
  const feats = (j.features ?? []) as { attributes?: { BASENAME?: string } }[];
  return feats[0]?.attributes?.BASENAME ?? "NO_ZCTA_AT_THIS_POINT";
}

async function resolve(subject: CfdSubject): Promise<{
  subject: CfdSubject;
  points: PlatPoint[];
  platsWithoutGeometry: string[];
  tally: Record<string, number>;
}> {
  const q = new URLSearchParams({
    where: subject.platWhere,
    outFields: "SUB_NAME,SEQ_NUM,BOOK_PAGE",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  const j = await getJson(`${SUBDIVISIONS}?${q}`, `${subject.name}: subdivision query`);
  const feats = (j.features ?? []) as {
    attributes: { SUB_NAME: string; SEQ_NUM: string | null };
    geometry?: { rings?: number[][][] };
  }[];

  if (feats.length === 0) {
    throw new Error(
      `${subject.name}: the county subdivision layer returned ZERO plats for \`${subject.platWhere}\`. ` +
        "That is a FAILED QUERY, not a finding that the district has no land — its formation " +
        "resolution recites the land and no query result can unmake that.",
    );
  }

  const points: PlatPoint[] = [];
  const platsWithoutGeometry: string[] = [];
  for (const f of feats) {
    const c = ringCentroid(f.geometry ?? {});
    const plat = f.attributes.SUB_NAME.replace(/\s+/g, " ").trim();
    if (!c) {
      platsWithoutGeometry.push(plat);
      continue;
    }
    points.push({
      plat,
      sequence: f.attributes.SEQ_NUM,
      lon: c[0],
      lat: c[1],
      zcta: await zctaAt(c[0], c[1]),
      rings: f.geometry?.rings ?? [],
    });
    await new Promise((r) => setTimeout(r, 120));
  }

  const tally: Record<string, number> = {};
  for (const p of points) tally[p.zcta] = (tally[p.zcta] ?? 0) + 1;
  return { subject, points, platsWithoutGeometry, tally };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const zip = arg("zip");
  const out = arg("json");
  const geojson = arg("geojson");
  const results = [];

  for (const s of SUBJECTS) {
    const r = await resolve(s);
    results.push(r);
    console.log(`\n${"=".repeat(78)}\n${s.name}`);
    console.log(`  formed          ${s.formedOn} — ${s.formationInstrument}`);
    console.log(`  governing board ${s.governingBoard}`);
    console.log(`  land recited as ${s.legalDescription.slice(0, 120)}...`);
    console.log(`  recorded plats  ${r.points.length} located, ${r.platsWithoutGeometry.length} without geometry`);
    for (const p of r.platsWithoutGeometry) {
      console.log(`      NO GEOMETRY — a failed read of this plat: ${p}`);
    }
    console.log(`  ZCTA tally      ${Object.entries(r.tally).map(([z, n]) => `${z}=${n}`).join("  ")}`);

    if (zip) {
      const inside = r.points.filter((p) => p.zcta === zip).length;
      const verdict =
        inside === r.points.length
          ? `GOVERNS ${zip} — every located plat is inside it`
          : inside === 0
            ? `DOES NOT GOVERN ${zip} — no located plat is inside it`
            : `PARTLY IN ${zip} — ${inside} of ${r.points.length} located plats`;
      console.log(`  VERDICT         ${verdict}`);
    }
  }

  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          method:
            "formation resolution -> recorded-plat legal description -> the county's own Subdivisions layer -> ring centroid -> Census TIGERweb ZCTA point query",
          zip: zip ?? null,
          collectedAt: process.env.WTP_TODAY ?? null,
          results,
        },
        null,
        1,
      )}\n`,
      "utf8",
    );
    console.log(`\nwrote ${out}`);
  }

  /*
   * ------------------------------------------------- the territory itself
   *
   * **NH233 — A VERIFIED GOVERNMENT THAT COULD REACH NO READER.**
   *
   * The Rocking K South Community Facilities District is a real political
   * taxing subdivision of 85641 with its own board and its own resolution
   * series, and it rendered to nobody. `bodiesAt` matches a body to a reader
   * on `ocdId`, and the smallest division containing this district is
   * `county:pima` — 9,200 square miles against the district's 2,047 acres.
   * Attaching it there would have shown a district that taxes 2,047 acres to
   * every reader in Pima County: a false claim about their government, in the
   * direction that looks like coverage. So `ocdId` was left null, which is the
   * honest choice and left the body stranded.
   *
   * The missing thing was never the division. It was the GEOMETRY, and this
   * script has been fetching it all along — `returnGeometry: "true"`, rings and
   * all — and throwing everything but a centroid away.
   *
   * So the rings are emitted, and `lib/registry/body-territory.ts` point-tests
   * them with the same even-odd implementation that decides every other
   * government. That gives an EXACT answer rather than a hedge: a reader inside
   * a Rocking K plat is governed by it, a reader elsewhere in 85641 is not, and
   * neither is told something we cannot support.
   *
   * **This is the reusable shape, not a special case for one district.** Any
   * government whose authoritative territory is finer than, or differently
   * shaped from, the Census division model — community facilities districts,
   * special taxing districts, districts crossing a county line — binds the same
   * way: name the body, cite the document that recites the land, emit the
   * polygons the authoritative publisher holds.
   */
  if (geojson) {
    const features = results.flatMap((r) =>
      r.points
        .filter((p) => p.rings.length > 0)
        .map((p) => ({
          type: "Feature" as const,
          properties: {
            bodyId: r.subject.bodyId,
            bodyName: r.subject.name,
            plat: p.plat,
            sequence: p.sequence,
            zcta: p.zcta,
            /* The document that makes this polygon this body's territory. */
            formationInstrument: r.subject.formationInstrument,
            formationSource: r.subject.formationSource,
            platSource: SUBDIVISIONS,
            platSourceOrg: "Pima County GIS, Land Records — Subdivisions layer",
          },
          geometry: { type: "Polygon" as const, coordinates: p.rings },
        })),
    );

    /*
     * RULING 100 — an operation that can return nothing is asked what it
     * returned. A territory file with no features would silently un-govern
     * every body it covers on the next build, which is the NH232 shape again.
     */
    if (features.length === 0) {
      throw new Error(
        "refusing to write a territory file with ZERO polygons. Every subject's plats returned " +
          "geometry a moment ago; an empty emission is a failed run, not a district with no land.",
      );
    }

    writeFileSync(
      geojson,
      `${JSON.stringify(
        {
          note:
            "BODY TERRITORIES — polygons for governments whose authoritative territory is finer " +
            "than any Census division. Each feature names the body it belongs to and the formation " +
            "document that recites the land. Generated by `pnpm cfd:territory --geojson`; read by " +
            "lib/registry/body-territory.ts. NH233.",
          generatedAt: process.env.WTP_TODAY ?? null,
          type: "FeatureCollection",
          features,
        },
        null,
        1,
      )}\n`,
      "utf8",
    );
    console.log(`\nwrote ${geojson} — ${features.length} polygon(s) across ${results.length} district(s)`);
  }
}

await main();
