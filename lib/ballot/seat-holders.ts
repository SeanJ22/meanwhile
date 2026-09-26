/**
 * WHO SITS IN THIS SEAT, READ FROM THE BODY THAT HOLDS IT.
 * (2026-08-26, the sources-and-incumbency session. Items 11 and 12.)
 *
 * This is the half RULING 166 supplies to the incumbency fix: incumbency is a
 * fact about holding the office, so it is read from the OFFICEHOLDER side —
 * and the officeholder side, for New Hampshire, is a text file the General
 * Court publishes at `gc.nh.gov/downloads/Members.txt`.
 *
 * **WHAT `electedStatus` ACTUALLY MEANS, because the obvious reading is wrong
 * and it matters.** The field reads ` Incumbent` (279 rows), `new` (109),
 * `Former` (18) or empty (2). The tempting reading is *Incumbent = currently
 * sits*. It is not: **`new` members sit too** — the value describes what the
 * person was AT THE LAST ELECTION, not whether they are in office now.
 *
 * The arithmetic settles it. 408 rows; 279 + 109 = 388 sitting; 18 `Former`
 * plus 2 unstated make up the rest. 388 across a 400-seat House and a 24-seat
 * Senate is a chamber with vacancies, which is what New Hampshire has. Reading
 * `new` as *not sitting* would have marked **Daniel E. Innis**, the sitting
 * Senator for District 7, and **Gregory M. Sargent**, a sitting representative
 * for Merrimack 7, as non-incumbents — two false claims about named people,
 * made while fixing a defect that was itself a false claim about a named
 * person.
 *
 * So: **SITS = `INCUMBENT` or `NEW`.** `FORMER` does not. `UNSTATED` does not
 * either — not because those two people are not in office, but because the
 * file does not say, and filling in a plausible value is the fabrication rule.
 * Their districts read UNKNOWN, which is honest and is a fact about the record
 * rather than about them.
 */

import type { SeatHolderRef } from "./incumbency.ts";
import type { NhMemberReadModel } from "../civic-data/candidate-builders.ts";
import { readNhMembers } from "../civic-data/state-members.ts";
import { requiredRoutineContract } from "../civic-data/contracts.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import {
  civicDataReadNotInitialized,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";

type CorpusMember = NhMemberReadModel["members"][number];

let readState: CivicDataReadResult<NhMemberReadModel> = civicDataReadNotInitialized(
  "STATE_LEGISLATOR",
  "US-NH",
  "The NH seat-holder projection has not been preloaded for this process.",
);

/** Load the promoted roster (or the explicit bootstrap state after an absent pointer). */
export async function refreshNhSeatHolders(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<NhMemberReadModel>> {
  readState = await readNhMembers(options);
  return readState;
}

/** The NH roster, edge first (2026-09-25): the reader edge's proven copy through the same Reader, else the database. */
const NH_MEMBERS = requiredRoutineContract("nh-members");
export const settleNhSeatHolders = (): Promise<CivicDataReadResult<NhMemberReadModel>> =>
  readPromotedEdgeFirst(NH_MEMBERS.recordClass, NH_MEMBERS.scope, refreshNhSeatHolders, "The New Hampshire roster");

export function nhSeatHolderReadState(): CivicDataReadResult<NhMemberReadModel> {
  return readState;
}

function heldRoster(): NhMemberReadModel | null {
  return readState.kind === "PROMOTED" || readState.kind === "BOOTSTRAP" ? readState.value : null;
}

/** Does this row describe somebody currently in office? See the header. */
export function sits(status: CorpusMember["electedStatus"]): boolean {
  return status === "INCUMBENT" || status === "NEW";
}

/**
 * The county and district a New Hampshire legislative contest is for.
 *
 * Read from the contest TITLE, which the ballot corpus curates as
 * *"State Representative, Merrimack County District 7"* and
 * *"State Senator, District 7"*. The OCD id carries `sldl:607`, which is a
 * TIGER code and does NOT decompose into the county-and-number pair the
 * legislature's own roster is keyed on — so the title is the only bridge
 * available today, and its use is stated rather than hidden.
 *
 * Returns `null` on anything it cannot read confidently. A partial parse here
 * would silently key the lookup to the wrong district.
 */
export function nhSeatKeyFromTitle(title: string): { chamber: "H" | "S"; county: string | null; district: string } | null {
  const t = title.trim();

  const house = /^State Representative,\s*([A-Za-z ]+?)\s+County\s+District\s+(\d+)\s*$/i.exec(t);
  if (house) return { chamber: "H", county: house[1].trim(), district: house[2] };

  const senate = /^State Senator,\s*District\s+(\d+)\s*$/i.exec(t);
  if (senate) return { chamber: "S", county: null, district: senate[1] };

  return null;
}

/**
 * Whether the General Court's complete membership projection is competent for
 * this exact contest. Keep the state/division gate beside the strict office
 * parser so the production preload and the later universe decision cannot
 * drift into opening or applying this authority to different seats.
 */
export function nhLegislativeRosterAppliesTo(contest: { readonly title: string; readonly ocdId: string }): boolean {
  return contest.ocdId.includes("/state:nh/") && nhSeatKeyFromTitle(contest.title) !== null;
}

/**
 * Everyone currently sitting in the seat a New Hampshire legislative contest
 * is for, or an empty list when we cannot say.
 */
export function nhLegislativeHolders(contestTitle: string): SeatHolderRef[] {
  const c = heldRoster();
  if (c === null) return [];
  const key = nhSeatKeyFromTitle(contestTitle);
  if (key === null) return [];

  return c.members
    .filter((m) => m.chamber === key.chamber)
    .filter((m) => m.district === key.district)
    .filter((m) => (key.county === null ? true : m.county.toLowerCase() === key.county.toLowerCase()))
    .filter((m) => sits(m.electedStatus))
    .map((m) => ({
      familyName: m.familyName,
      // The middle name is carried into the given name so the matcher can see
      // it: *Karen E. Ebel* against a filing that reads *Karen Elizabeth Ebel*
      // is exactly the comparison `namesAgree` exists to make, and dropping the
      // middle name here would throw away the evidence it needs.
      givenName: [m.givenName, m.middleName].filter(Boolean).join(" "),
      // `seatNo` is the body's own identifier, and it is NOT the `member=` id
      // on a member page — those are different numbers, confirmed 2026-08-26.
      // It is carried so a future ballot corpus that records it can join on an
      // identifier instead of a name, per RULING 111.
      personKey: m.seatNo || null,
      source: `New Hampshire General Court — ${readState.kind.toLowerCase()} Members.txt, source through ${readState.metadata.sourceThrough ?? "not recorded"}; version ${readState.metadata.version ?? readState.metadata.versionId ?? "not recorded"}; ${readState.metadata.stale.toLowerCase()}`,
    }));
}

/** Every seat this corpus can answer for, for reporting a denominator. */
export function nhCorpusStanding(): { members: number; sitting: number; collectedAt: string } | null {
  const c = heldRoster();
  if (c === null) return null;
  return {
    members: c.members.length,
    sitting: c.members.filter((m) => sits(m.electedStatus)).length,
    collectedAt: readState.metadata.sourceThrough ?? readState.metadata.retrievedAt ?? "not recorded",
  };
}
