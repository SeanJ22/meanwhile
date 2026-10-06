import { ensureReaderAuthorityEdge, readReaderManifest } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { settleOutcomeRead, sittingsForBody } from "@/lib/outcomes/store";
import { linkLocalVotes, localVotesForMember, type LocalVoteRosterFor } from "@/lib/outcomes/local-votes";
import { rosterForBody } from "@/lib/registry/body-rosters";

/**
 * GET /api/votes/local?personId=roster:<bodyId>#<n>
 *
 * A local official's recorded votes (BX-11): each roll call row in the body's
 * minutes whose voter joins exactly this roster member on the same body, newest
 * first. The position is the publisher's own word and every row carries the
 * sitting page it was read from. A member with no linked vote returns an empty
 * list, which the card words as "We're working on getting this info".
 */

export const runtime = "nodejs";

const ROSTER_ID = /^roster:(.+)#\d+$/;
const rosterMembers: LocalVoteRosterFor = (bodyId) => rosterForBody(bodyId)?.members ?? [];

export async function GET(request: Request) {
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
}
