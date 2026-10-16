import { readerRoute } from "@/lib/api/reader-route";
import { ensureReaderAuthorityEdge, readReaderManifest } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { settleOutcomeRead, sittingsForBody } from "@/lib/outcomes/store";
import { linkLocalVotes, localVotesForMember, type LocalVoteRosterFor } from "@/lib/outcomes/local-votes";
import { rosterForBody } from "@/lib/registry/body-rosters";



export const runtime = "nodejs";

const ROSTER_ID = /^roster:(.+)#\d+$/;
const rosterMembers: LocalVoteRosterFor = (bodyId) => rosterForBody(bodyId)?.members ?? [];

export const GET = readerRoute("/api/votes/local", async function GET(request: Request) {
  const personId = new URL(request.url).searchParams.get("personId") ?? "";
  const bodyId = ROSTER_ID.exec(personId)?.[1];
  if (!bodyId || personId.length > 300) return Response.json({ error: "personId required" }, { status: 400 });
  try {
    const manifest = await readReaderManifest().catch(() => null);
    const authority = manifest ? await ensureReaderAuthorityEdge(manifest, undefined, ["registry-runtime", "meeting-outcomes"]).catch(() => null) : null;
    if (authority) enterReaderAuthorityEdge(authority);
    await settleOutcomeRead();
  } catch (error) {
    return Response.json({ error: "the outcomes could not be read right now", dataState: "STORE_UNREACHABLE", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  }
  const linking = linkLocalVotes(sittingsForBody(bodyId), rosterMembers);
  const votes = localVotesForMember(linking.records, personId);
  return Response.json({ personId, bodyId, votes, count: votes.length, holdingStatus: votes.length > 0 ? "HELD" : "HELD_NO_RECORD" });
});
