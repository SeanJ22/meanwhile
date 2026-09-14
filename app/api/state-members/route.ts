import { readNhMembers } from "@/lib/civic-data/state-members";
import { readOfficialStateLegislatorsProjection } from "@/lib/state-rollcalls/legislators";
import { officialStateLegislatorTargetByScope } from "@/lib/state-rollcalls/authority";

/** Official promoted state-member read model; no acquisition/staging tables. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const jurisdiction = new URL(request.url).searchParams.get("jurisdiction");
  const target = jurisdiction ? officialStateLegislatorTargetByScope(jurisdiction) : null;
  if (!target) {
    return Response.json({ error: "jurisdiction must be one of US-AZ, US-NH, or US-NJ" }, { status: 400 });
  }
  // Resolve the exact jurisdiction before opening its one permitted store.
  if (target.state !== "NH") {
    const official = await readOfficialStateLegislatorsProjection(target.jurisdiction);
    if (official.kind === "STORE_UNREACHABLE") {
      return Response.json(
        { jurisdiction, holdingStatus: official.kind, code: official.code, detail: official.detail, metadata: official.metadata, members: [] },
        { status: 503, headers: { "cache-control": "private, no-store" } },
      );
    }
    if (official.kind === "NOT_RECORDED") {
      return Response.json(
        { jurisdiction, holdingStatus: official.kind, detail: official.detail, metadata: official.metadata, members: [] },
        { status: 404, headers: { "cache-control": "private, no-store" } },
      );
    }
    return Response.json({
      jurisdiction,
      holdingStatus: official.kind,
      metadata: official.metadata,
      versionId: official.metadata.versionId,
      term: official.value.term,
      count: official.value.roster.officeholders.length,
      members: official.value.roster.officeholders,
      divisions: official.value.roster.divisions,
    }, { headers: { "cache-control": "private, no-store" } });
  }
  const held = await readNhMembers();
  if (held.kind === "STORE_UNREACHABLE") {
    return Response.json(
      { jurisdiction, holdingStatus: held.kind, code: held.code, detail: held.detail, metadata: held.metadata, members: [] },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (held.kind === "NOT_RECORDED") {
    return Response.json(
      { jurisdiction, holdingStatus: held.kind, detail: held.detail, metadata: held.metadata, members: [] },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }
  return Response.json({
    jurisdiction,
    holdingStatus: held.kind,
    metadata: held.metadata,
    versionId: held.metadata.versionId,
    term: held.value.term,
    count: held.value.members.length,
    members: held.value.members,
  }, { headers: { "cache-control": "private, no-store" } });
}
