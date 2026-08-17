import az from "../../data/zcta/zcta-04.json" with { type: "json" };
import nh from "../../data/zcta/zcta-33.json" with { type: "json" };
import nj from "../../data/zcta/zcta-34.json" with { type: "json" };

/**
 * One zip's polygon, for the current-zip shading (g4 item 4).
 *
 * ## Why this is server-side and not another file under public/geo
 *
 * The polygons are `pnpm zcta:outlines` output: 1,242 ZCTAs across the three
 * covered states, 1.06 MB in total and 599 KB for Arizona alone. Every other
 * overlay in this product ships to the browser as a whole layer because the
 * reader looks at ALL of it — every district boundary in view is drawn. The
 * zip shading is the opposite shape: the reader looks at exactly ONE polygon,
 * the one they are standing in, and the other 403 in the state are dead
 * weight. Shipping the state file to tint one shape would have cost more than
 * the entire rest of the map put together.
 *
 * So the geometry stays on the server and `/api/zcta/<zip>` hands back the
 * one feature — about 300 bytes.
 *
 * ## The geometry is orientation and nothing else
 *
 * The warning from `scripts/fetch-zcta-outlines.mts`, kept next to the code
 * that serves it: a ZCTA crosses city, county, school district and
 * legislative lines, `CLAUDE.md` forbids treating a zip as district truth,
 * and nothing in this product joins against these shapes. They decide which
 * pixels are tinted. They are generalized to ~200 m for exactly that reason.
 */

interface ZctaFeature {
  type: "Feature";
  properties: { zip: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

interface ZctaFile {
  features: ZctaFeature[];
  source: string;
  sourceOrg: string;
  collectedAt: string;
}

const FILES = [az, nh, nj] as unknown as ZctaFile[];

/**
 * zip → feature, built once on first use.
 *
 * Three files of a few hundred features each; building the index eagerly at
 * module load would cost every route that merely imports this file.
 */
let index: Map<string, ZctaFeature> | null = null;

function byZip(): Map<string, ZctaFeature> {
  if (index) return index;
  const built = new Map<string, ZctaFeature>();
  for (const file of FILES) {
    for (const feature of file.features ?? []) {
      built.set(feature.properties.zip, feature);
    }
  }
  index = built;
  return built;
}

/** How many polygons are held, so a caller can state its denominator. */
export function zctaOutlineCount(): number {
  return byZip().size;
}

/** The provenance every externally sourced record carries. */
export const ZCTA_OUTLINE_SOURCE = {
  url: FILES[0]?.source ?? "",
  org: FILES[0]?.sourceOrg ?? "U.S. Census Bureau",
  collectedAt: FILES[0]?.collectedAt ?? "",
};

/**
 * The polygon for one zip, or null.
 *
 * Null is a real and common answer — the covered states hold 1,242 of the
 * country's 33,144 ZCTAs, and two zips inside the covered states have a
 * centroid but no area at all (a point ZIP serving a single building). The
 * caller renders no shading, never a guess at where the zip is: the map has
 * already flown to the centroid, and a wrong polygon would be a claim about
 * a boundary rather than a missing decoration.
 */
export function zctaOutline(zip: string): ZctaFeature | null {
  if (!/^\d{5}$/.test(zip)) return null;
  return byZip().get(zip) ?? null;
}
