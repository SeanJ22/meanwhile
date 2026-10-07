import { directoryFor } from "@/lib/officials/directory";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import { matching, refuse, rejectUnknown } from "@/lib/api/params";
import { currentMemberOffices, settleMemberOfficesRead } from "@/lib/officials/member-offices-read";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";

/**
 * GET /api/directory?member=<source>:<id>
 *
 * One member's offices and committee seats. `private, no-store`: the response varies by `member`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEDERAL_ID = /^congress:[A-Z]\d{6}$/;
/** A federal member, or a state legislator as the legislature's own roster names them (`<state>-legislature:<id>`). */
const MEMBER_ID = /^(?:congress:[A-Z]\d{6}|[a-z]+(?:-[a-z]+)+:[A-Za-z0-9_-]+)$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  /* A missing or malformed `member` refuses with a stated reason; the empty answer is reserved for a real member we hold no record of. */
  const unknown = rejectUnknown(params, ["member"]);
  if (!unknown.ok) return refuse(unknown.error);

  const read = matching(params, "member", MEMBER_ID, "refuse");
  if (!read.ok || !memberDirectoryReaches(String(read.value), "offices")) {
    return refuse(
      `${read.ok ? "member is neither a federal member nor a state legislator" : read.error}. This route serves congress:<bioguide> (e.g. congress:C001133) and state legislators by their legislature's roster id (e.g. nj-legislature:498)`,
    );
  }
  const member = read.value as string;

  // A state legislator: their capitol and district offices, read from Open States onto the
  // legislature's own roster row. No committee source reaches them, so none is claimed.
  if (!FEDERAL_ID.test(member)) {
    try {
      await settleMemberOfficesRead();
    } catch {
      return Response.json({ holdingStatus: "HOLDING_UNAVAILABLE", error: "We couldn’t load the office records just now." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    const offices = currentMemberOffices(member);
    return Response.json({
      source: null,
      districtOffices: offices.map((row) => row.office),
      committees: [],
      officeDetails: offices.map((row) => ({ officeKind: row.officeKind, sourceUrl: row.sourceUrl, sourceOrg: row.sourceOrg, collectedAt: row.collectedAt, official: row.official })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  let found;
  try {
    await refreshFederalDirectoryFromPromoted();
    found = directoryFor(member);
  }
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
