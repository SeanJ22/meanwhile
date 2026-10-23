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

export async function refreshNhSeatHolders(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<NhMemberReadModel>> {
  readState = await readNhMembers(options);
  return readState;
}

const NH_MEMBERS = requiredRoutineContract("nh-members");
export const settleNhSeatHolders = (): Promise<CivicDataReadResult<NhMemberReadModel>> =>
  readPromotedEdgeFirst(NH_MEMBERS.recordClass, NH_MEMBERS.scope, refreshNhSeatHolders, "The New Hampshire roster");

export function nhSeatHolderReadState(): CivicDataReadResult<NhMemberReadModel> {
  return readState;
}

function heldRoster(): NhMemberReadModel | null {
  return readState.kind === "PROMOTED" || readState.kind === "BOOTSTRAP" ? readState.value : null;
}

/** `new` members sit too: the status describes the last election. FORMER and an unstated status do not count as sitting. */
export function sits(status: CorpusMember["electedStatus"]): boolean {
  return status === "INCUMBENT" || status === "NEW";
}

/** Read from the contest title: the OCD `sldl:` code is a TIGER code that does not decompose into county and district. Null on anything not read confidently. */
export function nhSeatKeyFromTitle(title: string): { chamber: "H" | "S"; county: string | null; district: string } | null {
  const t = title.trim();

  const house = /^State Representative,\s*([A-Za-z ]+?)\s+County\s+District\s+(\d+)\s*$/i.exec(t);
  if (house) return { chamber: "H", county: house[1].trim(), district: house[2] };

  const senate = /^State Senator,\s*District\s+(\d+)\s*$/i.exec(t);
  if (senate) return { chamber: "S", county: null, district: senate[1] };

  return null;
}

export function nhLegislativeRosterAppliesTo(contest: { readonly title: string; readonly ocdId: string }): boolean {
  return contest.ocdId.includes("/state:nh/") && nhSeatKeyFromTitle(contest.title) !== null;
}

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
      // The middle name stays so the matcher can compare it with the filed name.
      givenName: [m.givenName, m.middleName].filter(Boolean).join(" "),
      // `seatNo` is the body's own seat identifier, not the `member=` id on a member page.
      personKey: m.seatNo || null,
      source: `New Hampshire General Court — ${readState.kind.toLowerCase()} Members.txt, source through ${readState.metadata.sourceThrough ?? "not recorded"}; version ${readState.metadata.version ?? readState.metadata.versionId ?? "not recorded"}; ${readState.metadata.stale.toLowerCase()}`,
    }));
}
