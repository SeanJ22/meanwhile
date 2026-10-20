import { OWNER_SURFACE_FORMAT_VERSION, type OwnerDigestRecord } from "../control-plane/owner-surface.ts";
import type { AppendOnlyRepository } from "../control-plane/repository/types.ts";
import type { BoundedChildResult } from "./bounded-child-pass.ts";
import { FEDERAL_DIRECTORY_STATES, federalDirectoryForState, type FederalDirectoryReadModel, type FederalDirectoryState } from "../officials/federal-directory-data-plane.ts";
import { federalPartyBreakdowns, type FederalRollCallWindow, type FederalRollCallsReadModel } from "../votes/data-plane.ts";
import type { MemberVote, VotesSnapshot } from "../votes/types.ts";

/** The runner splits the held national people records once; this record is what keeps it from running again. */
export const FEDERAL_PEOPLE_SPLIT_LOG_KEY = "federal-people-split";
const RECORD_ID = "federal-people-split:v1";
const LINE = "FEDERAL_PEOPLE_SPLIT ";
const COUNT = "FEDERAL_PEOPLE_COUNT ";

export interface FederalPeopleCount { readonly old: number; readonly new: number; readonly missing: readonly string[]; readonly duplicated: readonly string[]; readonly added: readonly string[] }
export interface FederalPeopleSplit {
  readonly places: readonly { readonly state: FederalDirectoryState; readonly projection: FederalDirectoryReadModel }[];
  readonly members: readonly { readonly officeholderId: string; readonly positions: readonly MemberVote[] }[];
  readonly window: FederalRollCallWindow;
  readonly partyBreakdowns: FederalRollCallsReadModel["partyBreakdowns"];
  readonly count: { readonly members: FederalPeopleCount; readonly positions: FederalPeopleCount };
}

function counted(before: readonly string[], after: readonly string[]): FederalPeopleCount {
  const old = new Set(before), seen = new Set<string>(), duplicated = new Set<string>();
  for (const id of after) (seen.has(id) ? duplicated : seen).add(id);
  return { old: before.length, new: after.length, missing: [...old].filter(id => !seen.has(id)), duplicated: [...duplicated], added: [...seen].filter(id => !old.has(id)) };
}

export const federalPeopleCountClean = ({ members, positions }: FederalPeopleSplit["count"]) =>
  [members, positions].every(row => row.old === row.new && !row.missing.length && !row.duplicated.length && !row.added.length);

/** Each place's members and each member's positions, checked by id against the national records they come from. */
export function splitFederalPeople(directory: FederalDirectoryReadModel, rollCalls: { readonly snapshot: VotesSnapshot }): FederalPeopleSplit {
  const places = FEDERAL_DIRECTORY_STATES.map(state => ({ state, projection: federalDirectoryForState(directory, state) }));
  const { positions, ...window } = rollCalls.snapshot;
  const byMember = new Map<string, MemberVote[]>();
  for (const position of positions) byMember.set(position.officeholderId, [...byMember.get(position.officeholderId) ?? [], position]);
  const members = [...byMember].filter(([, rows]) => rows.length > 0).map(([officeholderId, rows]) => ({ officeholderId, positions: rows }));
  const parties = new Map(directory.roster.officeholders.map(holder => [holder.id, holder.partyLabel ?? null]));
  const key = (row: MemberVote) => `${row.voteId}|${row.officeholderId}`;
  return { places, members, window, partyBreakdowns: federalPartyBreakdowns(rollCalls.snapshot, parties), count: {
    members: counted(directory.roster.officeholders.map(holder => holder.id), places.flatMap(place => place.projection.roster.officeholders.map(holder => holder.id))),
    positions: counted(positions.map(key), members.flatMap(member => member.positions.map(key))),
  } };
}

export const federalPeopleSplitLine = (row: { readonly scope: string; readonly from: string; readonly to: string | null; readonly refusal?: string }) =>
  `${LINE}${JSON.stringify(row)}`;
export const federalPeopleCountLine = (count: FederalPeopleSplit["count"]) => `${COUNT}${JSON.stringify(count)}`;

export async function federalPeopleSplitRecorded(digests: AppendOnlyRepository<OwnerDigestRecord>): Promise<boolean> {
  return (await digests.read(FEDERAL_PEOPLE_SPLIT_LOG_KEY)).some(row => row.digestId === RECORD_ID);
}

/** A finished child's record, refusals included; null when it did not finish, so the next pass runs it again. */
export function federalPeopleSplitRecord(run: BoundedChildResult, at: string, testedSha: string | null): OwnerDigestRecord | null {
  if (run.status !== 0) return null;
  const output = run.stdout.split("\n");
  const lines = output.filter(line => line.startsWith(LINE)).map(line => line.slice(LINE.length));
  const count = output.find(line => line.startsWith(COUNT))?.slice(COUNT.length);
  if (!count) return null;
  const refused = lines.filter(line => !(JSON.parse(line) as { to: string | null }).to).length;
  const { members, positions } = JSON.parse(count) as FederalPeopleSplit["count"];
  return { formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId: RECORD_ID, writtenAt: at, lines: [count, ...lines], cycleOk: refused === 0, testedSha,
    headline: `Federal people split: ${members.new} members in their place records and ${positions.new} roll-call positions under their members ` +
      `(${members.old} and ${positions.old} before); ${lines.length - refused} records published, ${refused} refused and republish on their next run.` };
}
