/**
 * THE DIVISIONS A ZIP REACHES — AREA, NOT A POINT (`NJ01`, 2026-08-22).
 *
 * The ballot page resolved a zip to its ZCTA centroid and asked which divisions
 * contain that ONE point. 07866's centroid falls inside Rockaway Township.
 * Rockaway BOROUGH is a different municipality with its own council, its own
 * school district and its own ballot; its territory is also inside the 07866
 * ZCTA, and its residents write 07866 on their post.
 *
 * So a Borough resident entering their own zip saw the Township's government,
 * none of their own, and a four-candidate Borough council contest that did not
 * render at all. Not because the data was missing — because the resolver asked
 * a question a zip cannot answer.
 *
 * `CLAUDE.md` states the premise already: **a ZCTA crosses city, county, school
 * district and legislative boundaries, so a zip can never resolve a ballot.**
 * Resolving one point and rendering the answer as "your ballot" treats a ZCTA as
 * though it could. Reading the whole area and labelling what comes back treats
 * it as what it is — orientation.
 *
 * ## What this is NOT
 *
 * It is not a claim that a reader at this zip votes in every division returned.
 * They do not. It is the reason `CLAUDE.md` says to prompt for a street address
 * when a reader wants their actual ballot, and the reason anything surfaced
 * through this route renders with the jurisdiction printed beside it. The
 * product's job here is to stop HIDING a government from the people it governs.
 *
 * ## The centroid answer is kept, never replaced
 *
 * The union starts from the point-resolved divisions, so nothing a reader saw
 * yesterday can disappear today — the failed-fetch-empties-a-full-surface rule,
 * applied to a resolver change. A zip absent from the index (outside the
 * committed geometry) falls back to exactly the previous behaviour.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Index = {
  scope: string;
  zips: Record<string, string[]>;
};

let cache: Promise<Index | null> | null = null;

async function index(): Promise<Index | null> {
  cache ??= readFile(
    join(process.cwd(), "data", "derived", "zip-division-ids.json"),
    "utf8",
  )
    .then((text) => JSON.parse(text) as Index)
    .catch(() => {
      /*
       * A missing or unreadable index is OUR gap and must degrade to the
       * previous behaviour rather than to an empty ballot. The cache is cleared
       * so a transient failure does not become permanent for the process — the
       * same reasoning as `lib/registry/server.ts`.
       */
      cache = null;
      return null;
    });
  return cache;
}

/**
 * Every division whose territory reaches inside this zip, unioned with the
 * divisions containing the zip's centroid.
 *
 * @param zip Five digits. Anything else returns `pointDivisionIds` unchanged.
 * @param pointDivisionIds What the centroid resolved to. Always included.
 */
export async function divisionIdsForZipArea(
  zip: string | null,
  pointDivisionIds: readonly string[],
): Promise<string[]> {
  const out = new Set(pointDivisionIds);
  if (!zip || !/^\d{5}$/.test(zip)) return [...out];
  const idx = await index();
  for (const id of idx?.zips[zip] ?? []) out.add(id);
  return [...out];
}
