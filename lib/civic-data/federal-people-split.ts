import { OWNER_SURFACE_FORMAT_VERSION, type OwnerDigestRecord } from "../control-plane/owner-surface.ts";
import type { AppendOnlyRepository } from "../control-plane/repository/types.ts";
import type { BoundedChildResult } from "./bounded-child-pass.ts";

/** The runner splits the held national people records once; this record is what keeps it from running again. */
export const FEDERAL_PEOPLE_SPLIT_LOG_KEY = "federal-people-split";
const RECORD_ID = "federal-people-split:v1";
const LINE = "FEDERAL_PEOPLE_SPLIT ";
const COUNT = "FEDERAL_PEOPLE_COUNT ";

export interface FederalPeopleCount { readonly old: number; readonly new: number; readonly missing: readonly string[]; readonly duplicated: readonly string[]; readonly added: readonly string[] }
export interface FederalPeopleSplitCount { readonly members: FederalPeopleCount; readonly positions: FederalPeopleCount }

export const federalPeopleCountClean = ({ members, positions }: FederalPeopleSplitCount) =>
  [members, positions].every(row => row.old === row.new && !row.missing.length && !row.duplicated.length && !row.added.length);

export const federalPeopleSplitLine = (row: { readonly scope: string; readonly from: string; readonly to: string | null; readonly refusal?: string }) =>
  `${LINE}${JSON.stringify(row)}`;
export const federalPeopleCountLine = (count: FederalPeopleSplitCount) => `${COUNT}${JSON.stringify(count)}`;

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
  const { members, positions } = JSON.parse(count) as FederalPeopleSplitCount;
  return { formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId: RECORD_ID, writtenAt: at, lines: [count, ...lines], cycleOk: refused === 0, testedSha,
    headline: `Federal people split: ${members.new} members in their place records and ${positions.new} roll-call positions under their members ` +
      `(${members.old} and ${positions.old} before); ${lines.length - refused} records published, ${refused} refused and republish on their next run.` };
}
