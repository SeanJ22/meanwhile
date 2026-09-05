import { directoryFor } from "@/lib/officials/directory";
import { matching, refuse, rejectUnknown } from "@/lib/api/params";

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
  const params = new URL(request.url).searchParams;

  /*
   * ITEM 1b (2026-08-17): this route used to answer a MALFORMED `member` with
   * `{source: null, districtOffices: [], committees: []}` — byte-identical to
   * the answer for a real member we hold no record of — on the reasoning that
   * "an empty directory is the honest answer and the shape is the same."
   *
   * The shape being the same is precisely the problem. Those are two
   * different claims and only one of them is about a person: "we have no
   * directory record for Senator X" versus "you did not name a member." The
   * first rendered for the second is a manufactured claim about whoever the
   * reader happened to be looking at, and `use-member-directory.ts` already
   * keeps `failed` separate from "no record" specifically so it never has to.
   *
   * So a missing or malformed `member` refuses with a stated reason. The
   * honest empty below is reserved for the case it actually describes.
   */
  const unknown = rejectUnknown(params, ["member"]);
  if (!unknown.ok) return refuse(unknown.error);

  const read = matching(params, "member", FEDERAL_ID, "refuse");
  if (!read.ok) {
    return refuse(
      `${read.error}. This route serves federal members only, as congress:<bioguide> (e.g. congress:C001133)`,
    );
  }
  const member = read.value as string;

  let found;
  try { found = directoryFor(member); }
  catch {
    return Response.json({ holdingStatus: "HOLDING_UNAVAILABLE", error: "We couldn’t load the directory records just now." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
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
