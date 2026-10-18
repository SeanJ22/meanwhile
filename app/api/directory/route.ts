import { readerRoute } from "@/lib/api/reader-route";
import { directoryFor } from "@/lib/officials/directory";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import { selectedRegistryStates } from "@/lib/registry/runtime-read-model";
import { matching, refuse, rejectUnknown } from "@/lib/api/params";
import { readMemberOffices } from "@/lib/officials/member-offices-read";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";



export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEDERAL_ID = /^congress:[A-Z]\d{6}$/;
/** A federal member, or a state legislator as the legislature's own roster names them (`<state>-legislature:<id>`). */
const MEMBER_ID = /^(?:congress:[A-Z]\d{6}|[a-z]+(?:-[a-z]+)+:[A-Za-z0-9_-]+|plural:(?:[a-z]{2}:)?[a-f0-9-]+|ocd-person\/[a-f0-9-]+)$/;

export const GET = readerRoute("/api/directory", async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  /* A missing or malformed `member` refuses with a stated reason; the empty answer is reserved for a real member we hold no record of. */
  const unknown = rejectUnknown(params, ["member", "state"]);
  if (!unknown.ok) return refuse(unknown.error);

  const read = matching(params, "member", MEMBER_ID, "refuse");
  if (!read.ok || !memberDirectoryReaches(String(read.value), "offices", params.get("state") ?? undefined)) {
    return refuse(
      `${read.ok ? "member is neither a federal member nor a state legislator" : read.error}. This route serves congress:<bioguide> (e.g. congress:C001133) and state legislators by their legislature's roster id (e.g. nj-legislature:498)`,
    );
  }
  const member = read.value as string;

  // A state legislator: their capitol and district offices, read from Open States onto the
  // legislature's own roster row. No committee source reaches them, so none is claimed.
  if (!FEDERAL_ID.test(member)) {
    let offices;
    try {
      offices = await readMemberOffices(member,params.get("state") ?? undefined);
    } catch {
      return Response.json({ holdingStatus: "HOLDING_UNAVAILABLE", error: "We couldn’t load the office records just now." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json({
      source: null,
      districtOffices: offices.map((row) => row.office),
      committees: [],
      officeDetails: offices.map((row) => ({ officeKind: row.officeKind, sourceUrl: row.sourceUrl, sourceOrg: row.sourceOrg, collectedAt: row.collectedAt, official: row.official })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const places = selectedRegistryStates();
  if (!places.length) return refuse("a member of Congress is read from their place's record; add state=<postal code> (e.g. state=AZ)");
  let found;
  try {
    await refreshFederalDirectoryFromPromoted(places);
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

  const offices = await readMemberOffices(member, places[0]);
  return Response.json(
    {
      source: found.source,
      districtOffices: offices.map(row => row.office),
      officeDetails: offices.map(({officeKind,sourceUrl,sourceOrg,collectedAt,official}) => ({officeKind,sourceUrl,sourceOrg,collectedAt,official})),
      committees: found.entry.committees.map((seat) => ({
        ...seat,
        ...found.committeeJurisdictions[seat.committeeId],
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}, ["federal-directory","member-offices","state-legislators"]);
