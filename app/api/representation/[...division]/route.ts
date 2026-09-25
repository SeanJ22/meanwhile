import { stageTimer } from "@/lib/api/server-timing";
import {
  ensureReaderAuthorityEdge,
  readReaderManifest,
  READER_MANIFEST_CACHE_TAG,
  READER_MAP_AUTHORITY_FAMILIES,
} from "@/lib/meetings/edge-serving";
import { governingRosterHoldersForDivision, rosterGapsForDivision } from "@/lib/registry/body-rosters";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { divisionsByOcdIds, prefetchReaderGeography, seatHoldersForDivision } from "@/lib/registry/server";

/**
 * GET /api/representation/ocd-division/country:us/state:az/sldl:21
 *
 * Who holds a division's seats, keyed by THE DIVISION (M112, 2026-08-16).
 *
 * The battlecard for a drawn district used to resolve its officeholders out
 * of the coverage summary, which is point-scoped: it carries only the
 * divisions containing the reader. Every other district on the map therefore
 * came back empty, and the empty list rendered as a claim — "No sourced
 * officeholder for this division yet" — over people we hold. This route is
 * the resolution that sentence was standing in for.
 *
 * **The division is the PATH, never a query string.** D40's rule, at the
 * point where it would bite: the funding route was `public` with its target
 * in a query string, the CDN dropped the query, and production served one
 * campaign's books for three different politicians. An OCD-ID is already a
 * path — `ocd-division/country:us/state:az/sldl:21` — so it is spelled as
 * one here and every cache implementation keys on it by construction.
 * Distinct divisions cannot collide.
 *
 * The body is committed data with no reader input in it, so it is publicly
 * cacheable; distinctness is guaranteed by the path, not by the header.
 *
 * ## WGH-22 (2026-08-31) — THE DIVISION'S OWN FACTS TRAVEL WITH ITS PEOPLE
 *
 * The answer now carries `label`, `divisionType` and `tier` beside `holders`.
 * A reader who has confirmed an address is owed the districts that govern
 * THEM, and the ZIP-scoped coverage payload provably cannot carry a district
 * the ZIP centroid is not inside — so the panel has to ask for it by key. It
 * cannot render what comes back without a name, and `CLAUDE.md` forbids an
 * OCD-ID reaching a reader, so the name travels with the people rather than
 * being reconstructed on the client from an identifier.
 *
 * The label comes off the same committed boundary registry every other
 * surface reads. `null` where the registry does not hold the division — an
 * honest absence, never a placeholder, and the caller renders its named gap.
 *
 * ## C21 (2026-09-25) — READ FROM THE READER EDGE, HELD BY THE CDN
 *
 * The coverage card calls this right after `/api/meetings`, and it never
 * entered the reader edge: on a cold instance the registry, the federal
 * directory and the district's state legislators were read from Neon, waking
 * it for a visitor. It now enters the edge exactly as `/api/meetings` does —
 * in this handler, never in a helper (AsyncLocalStorage.enterWith; see
 * tests/reader-edge-context.test.ts) — and falls back to the database only for
 * a family the manifest does not carry.
 *
 * The answer is public and keyed by the path, so the CDN holds it on the same
 * terms as `/api/meetings`: five minutes, purged with the `reader-manifest` tag
 * the runner purges on every publication, the browser revalidating each time.
 * A read that fails throws and is never answered, so only a computed answer is
 * held, as before; the refused shape below stays `no-store`.
 */

export const runtime = "nodejs";

const CDN_HELD = {
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=3600",
  "Netlify-Cache-Tag": READER_MANIFEST_CACHE_TAG,
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;

/** The identifier shape, refused rather than guessed at. */
const OCD_ID = /^ocd-division\/country:us(\/[a-z_]+:[A-Za-z0-9~._-]+)+$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ division: string[] }> },
) {
  const { division } = await context.params;
  const ocdId = division.map((segment) => decodeURIComponent(segment)).join("/");

  if (!OCD_ID.test(ocdId)) {
    // Not an OCD-ID. An empty answer in the same shape, and the client
    // renders its named gap — never a failure dressed as an absence.
    return Response.json(
      { ocdId: null, label: null, divisionType: null, tier: null, holderStatus: "HOLDING_UNAVAILABLE", holders: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const timing = stageTimer();
  // The registry load reads the committed geometry too; start it beside the edge fetch.
  prefetchReaderGeography();
  // C21: the reader authority edge, entered in this handler's own execution
  // before any edge-aware read below (see the header note).
  const manifest = await timing.time("manifest", () => readReaderManifest().catch(() => null));
  if (manifest?.authorityArtifacts) {
    const edge = await timing.time("authority", () =>
      ensureReaderAuthorityEdge(manifest, undefined, READER_MAP_AUTHORITY_FAMILIES).catch(() => null),
    );
    if (edge) enterReaderAuthorityEdge(edge);
  }

  // Both stores, the same two the shared resolver reads: legislative seats
  // off the officeholder index, local governing bodies off the curated
  // rosters. Asked by division key, so neither depends on where the reader is.
  const seats = await timing.time("holders", () => seatHoldersForDivision(ocdId));
  const holders = seats.length > 0 ? seats : governingRosterHoldersForDivision(ocdId);

  // The division's own facts, off the same committed registry the map draws
  // from. Absent rather than invented when the registry does not hold it.
  const [known] = await timing.time("division", () => divisionsByOcdIds([ocdId]));

  return Response.json(
    {
      ocdId,
      label: known?.label ?? null,
      divisionType: known?.divisionType ?? null,
      tier: known?.tier ?? null,
      holderStatus: /\/(?:sldu|sldl):/.test(ocdId)
        ? holders.length > 0 ? "HELD" : "HOLDING_UNAVAILABLE"
        : holders.length > 0
          ? "HELD"
          : "NOT_RECORDED",
      holders,
      rosterGaps: rosterGapsForDivision(ocdId),
    },
    {
      headers: { ...CDN_HELD, "Server-Timing": timing.header() },
    },
  );
}
