import { directoryFor } from "@/lib/officials/directory";

/**
 * GET /api/directory?member=congress:C001133
 *
 * One federal member's district offices and committee seats, from the
 * SHA-pinned congress-legislators table (item 7, 2026-08-16). A directory,
 * not a ledger — no votes, no money, no statements.
 *
 * **The response varies by `member`, so it is not publicly cacheable on the
 * query string alone.** D40's lesson, stated at the point it would bite: the
 * funding route was `public` with the target in a query string, the CDN
 * dropped the query, and production served one campaign's books for three
 * different politicians. This route is explicitly `private, no-store` —
 * distinct members cannot be served the same body because nothing is
 * cached at all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEDERAL_ID = /^congress:[A-Z]\d{6}$/;

export function GET(request: Request) {
  const member = new URL(request.url).searchParams.get("member") ?? "";

  if (!FEDERAL_ID.test(member)) {
    // Not a federal member id. An empty directory is the honest answer and
    // the shape is the same, so the client renders "no directory record"
    // rather than a failure.
    return Response.json(
      { source: null, districtOffices: [], committees: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const found = directoryFor(member);
  if (!found) {
    return Response.json(
      { source: null, districtOffices: [], committees: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return Response.json(
    {
      source: found.source,
      districtOffices: found.entry.districtOffices,
      committees: found.entry.committees.map((seat) => ({
        ...seat,
        ...found.committeeJurisdictions[seat.committeeId],
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
