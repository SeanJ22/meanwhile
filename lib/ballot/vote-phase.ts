import { readReaderSetting } from "../civic-data/reader-settings-publication.ts";
import { registerSetting } from "../control-plane/settings.ts";
import { ocdStateCode } from "../ocd/state-of.ts";
import { stateClockZone } from "../time/county-time-zones.ts";
import { toZonedIso } from "../time/zoned.ts";
import type { ContestResult } from "./election-results.ts";

/**
 * Which question a contest's card asks: "Would you vote for them?" before its polls close, "How did you
 * vote? Tell us why." after. Each contest switches on its own; one Admin setting overrides all of them.
 */
export type VoteQuestionPhase = "before" | "after";
export type VoteQuestionSetting = "auto" | "before" | "after";

export const VOTE_QUESTION_SETTING = "ballot.voteQuestion";
const CHOICES = [
  { value: "auto", label: "Switch on each contest's own poll close" },
  { value: "before", label: "Always ask Would you vote for them?" },
  { value: "after", label: "Always ask How did you vote?" },
] as const;
const isSetting = (value: unknown): value is VoteQuestionSetting => CHOICES.some(choice => choice.value === value);

registerSetting({ key: VOTE_QUESTION_SETTING, label: "Vote question on ballot cards", defaultValue: "auto",
  readerFacing: true, control: "choice", choices: CHOICES, validate: isSetting });

export async function readVoteQuestionSetting(): Promise<VoteQuestionSetting> {
  const value = await readReaderSetting<string>(VOTE_QUESTION_SETTING, "auto");
  return isSetting(value) ? value : "auto";
}

/** With no state to read, the latest clock in the country, so a card never switches early. */
const LATEST_ZONE = "Pacific/Honolulu";
const CLOSE_HOUR = 21;

export function voteQuestionPhase(input: {
  setting: VoteQuestionSetting;
  contest: { result?: Pick<ContestResult, "status">; ocdId: string };
  electionDate: string | null;
  now: Date;
}): VoteQuestionPhase {
  if (input.setting !== "auto") return input.setting;
  const { result } = input.contest;
  /* A count in progress or a call exists only once the polls are shut. A contest headed to a runoff asks about the runoff, whose day the results do not carry: it stays "before" until the runoff is its own election. An unopposed seat says nothing about the day, so it follows the clock. */
  if (result?.status === "runoff") return "before";
  if (result && (result.status === "counting" || result.status === "called" || result.status === "certified")) return "after";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.electionDate ?? "");
  if (!match) return "before";
  const zone = stateClockZone(ocdStateCode(input.contest.ocdId) ?? "") ?? LATEST_ZONE;
  const close = Date.parse(toZonedIso(Number(match[1]), Number(match[2]), Number(match[3]), CLOSE_HOUR, 0, zone));
  return input.now.getTime() >= close ? "after" : "before";
}
