import type { VotesSnapshot } from "@/lib/votes/types";
import { getVotesSnapshot } from "@/lib/votes/snapshot";
import { partyBreakdownFor } from "@/lib/votes/party-breakdown";
import { keyVotesForMember, type MemberKeyVotes } from "@/lib/votes/key-votes-reader";
import { KEY_VOTES_CRITERIA } from "@/lib/votes/key-votes";
import { partyByOfficeholderId } from "@/lib/registry/server";
import { getStateVotesSnapshot } from "@/lib/sources/legiscan/snapshot";
import { LEGISCAN_ATTRIBUTION } from "@/lib/sources/legiscan/types";

/**
 * GET /api/votes?member=congress:C001133 — a federal member
 * GET /api/votes?member=plural:<uuid>    — a state legislator (D49)
 *
 * A member's recent recorded votes, from a committed snapshot — never a live
 * fetch against the chambers or LegiScan. Returns the votes newest-first with
 * the member's position attached, plus the snapshot's generatedAt so the
 * surface can say how fresh "recent" is.
 *
 * State rows carry `attribution` because LegiScan's data is CC BY 4.0 and the
 * licence requires it wherever the data appears. Federal rows do not: those
 * come from the chambers' own public-domain XML.
 */

export const runtime = "nodejs";

const FEDERAL_ID = /^congress:[A-Z]\d{6}$/;
const STATE_ID = /^plural:[0-9a-f-]{36}$/i;

/** A state legislator's recent roll calls, in the federal rows' shape. */
function stateVotes(member: string) {
  let snap;
  try {
    snap = getStateVotesSnapshot();
  } catch {
    return Response.json({ generatedAt: null, member, holdingStatus: "HOLDING_UNAVAILABLE", votes: [] }, { status: 503 });
  }

  const positions = new Map(
    snap.positions
      .filter((p) => p.officeholderId === member)
      .map((p) => [p.rollCallId, p.position]),
  );

  const votes = snap.rollCalls
    .filter((r) => positions.has(r.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((r) => ({
      id: r.id,
      jurisdiction: { level: "state" as const, state: r.state },
      // The bill's official title, as the legislature published it. Never
      // ours — the same rule the federal rows ship under.
      title: r.billTitle,
      titleSource: "BILL_TITLE" as const,
      // The chamber's own description of the motion.
      question: r.motion,
      result: r.result,
      legisNum: r.billNumber || null,
      billUrl: r.billUrl,
      rollCallUrl: r.rollCallUrl,
      date: r.date,
      position: positions.get(r.id),
      // A party-by-party count is REFUSED here rather than estimated. We hold
      // positions only for the members whose district our geometry clips, so
      // any tally we computed would be a fraction of the chamber's and could
      // never sum to the recorded result — which is exactly the condition the
      // federal breakdown refuses on.
      partyBreakdown: null,
    }));

  return Response.json({
    member,
    holdingStatus: "HELD",
    count: votes.length,
    generatedAt: snap.generatedAt,
    attribution: LEGISCAN_ATTRIBUTION,
    votes,
  });
}

export async function GET(request: Request) {
  const member = new URL(request.url).searchParams.get("member");
  if (!member || (!FEDERAL_ID.test(member) && !STATE_ID.test(member))) {
    return Response.json(
      { error: "member must be a congress:<bioguide> or plural:<uuid> id" },
      { status: 400 },
    );
  }

  if (STATE_ID.test(member)) return stateVotes(member);

  let snap: VotesSnapshot;
  try {
    snap = getVotesSnapshot();
  } catch {
    return Response.json({ generatedAt: null, member, holdingStatus: "HOLDING_UNAVAILABLE", votes: [] }, { status: 503 });
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
      jurisdiction: { level: "federal" as const },
      position: positions.get(v.id),
      partyBreakdown: partyBreakdownFor(v.id, v.result, snap.positions, parties),
    }));

  /*
   * Item 6b (2026-08-15): the "When it mattered" column's rows, served
   * beside the recent ones so one card renders two answers from one request.
   *
   * The CHAMBER RULE is enforced upstream in `keyVoteRowsFor`, which is
   * handed a chamber and never reads the other array — so a House member's
   * card cannot render a Senate roll call even by mistake. A member with no
   * chamber (nobody outside Congress) gets an empty list and the column does
   * not render at all, rather than a header over nothing.
   */
  let curated: MemberKeyVotes;
  try { curated = await keyVotesForMember(member); }
  catch {
    return Response.json({ member, holdingStatus: "HOLDING_UNAVAILABLE", error: "We couldn’t load the held key-vote records just now." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const { chamber, rows: keyVotes } = curated;

  return Response.json({
    member,
    holdingStatus: "HELD",
    count: votes.length,
    generatedAt: snap.generatedAt,
    votes,
    chamber,
    keyVotes,
    keyVotesCriteria: keyVotes.length > 0 ? KEY_VOTES_CRITERIA : null,
  });
}
