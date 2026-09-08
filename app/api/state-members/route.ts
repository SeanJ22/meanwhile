import { promotedNhMembers } from "@/lib/civic-data/state-members";

/** Official promoted state-member read model; no acquisition/staging tables. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const jurisdiction = new URL(request.url).searchParams.get("jurisdiction");
  if (jurisdiction !== "US-NH") {
    return Response.json({ error: "jurisdiction must be US-NH" }, { status: 400 });
  }
  const held = await promotedNhMembers();
  if (!held) return Response.json({ jurisdiction, holdingStatus: "HOLDING_UNAVAILABLE", members: [] }, { status: 503 });
  return Response.json({ jurisdiction, holdingStatus: "HELD", versionId: held.versionId, term: held.data.term, count: held.data.members.length, members: held.data.members }, { headers: { "cache-control": "private, no-store" } });
}
