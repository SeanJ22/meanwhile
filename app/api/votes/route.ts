import type { VotesSnapshot } from "@/lib/votes/types";
import { getVotesSnapshot } from "@/lib/votes/snapshot";
import { partyBreakdownFor } from "@/lib/votes/party-breakdown";
import { partyByOfficeholderId } from "@/lib/registry/server";

/**
 * GET /api/votes?member=congress:C001133
 *
 * A member's recent recorded votes, from the committed roll-call snapshot —
 * never a live fetch against the chambers. Returns the votes newest-first
 * with the member's position attached, plus the snapshot's generatedAt so
 * the surface can say how fresh "recent" is.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const member = new URL(request.url).searchParams.get("member");
  if (!member || !/^congress:[A-Z]\d{6}$/.test(member)) {
    return Response.json(
      { error: "member must be a congress:<bioguide> id" },
      { status: 400 },
    );
  }

  let snap: VotesSnapshot;
  try {
    snap = getVotesSnapshot();
  } catch {
    // No snapshot is an honest empty state, not a 500 — the popup renders
    // "no recorded votes on file yet".
    return Response.json({ generatedAt: null, votes: [] });
  }

  const positions = new Map(
    snap.positions
      .filter((p) => p.officeholderId === member)
      .map((p) => [p.voteId, p.position]),
  );

  // Item 3 (2026-08-14 second session): the party breakdown — pure
  // arithmetic over the snapshot's positions joined to the roster's
  // party labels, refused (null) unless it sums exactly to the
  // chamber's recorded tally. The surface renders the honest
  // unavailable state on null.
  const parties = await partyByOfficeholderId();

  // A member sits in one chamber, so their votes share a chamber and the
  // roll number orders them newest-first.
  const votes = snap.votes
    .filter((v) => positions.has(v.id))
    .sort((a, b) => b.rollNumber - a.rollNumber)
    .map((v) => ({
      ...v,
      position: positions.get(v.id),
      partyBreakdown: partyBreakdownFor(v.id, v.result, snap.positions, parties),
    }));

  return Response.json({ generatedAt: snap.generatedAt, votes });
}
