import { governingRosterHoldersForDivision } from "@/lib/registry/body-rosters";
import { seatHoldersForDivision } from "@/lib/registry/server";

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
 */

export const runtime = "nodejs";

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
      { ocdId: null, holders: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Both stores, the same two the shared resolver reads: legislative seats
  // off the officeholder index, local governing bodies off the curated
  // rosters. Asked by division key, so neither depends on where the reader is.
  const seats = await seatHoldersForDivision(ocdId);
  const holders = seats.length > 0 ? seats : governingRosterHoldersForDivision(ocdId);

  return Response.json(
    { ocdId, holders },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
