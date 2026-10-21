import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { readSetting, registerSetting } from "../control-plane/settings.ts";
import type { RoutineCadencePolicy } from "../civic-data/contracts.ts";

export const VOTING_REFRESH_SETTING = "voting.checkEveryMinutes";
export const VOTING_REFRESH_DEFAULT_MINUTES = 720;
const MINUTE = 60_000, DAY = 86_400_000;
let checkEveryMinutes = VOTING_REFRESH_DEFAULT_MINUTES;

registerSetting({ key: VOTING_REFRESH_SETTING, label: "Minutes between voting-location source checks",
  defaultValue: VOTING_REFRESH_DEFAULT_MINUTES, readerFacing: false, control: "number", unit: "minutes",
  validate: (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= VOTING_REFRESH_DEFAULT_MINUTES });

export function installVotingRefreshFrom(config: AdminConfig | null): void {
  const value = readSetting(config, VOTING_REFRESH_SETTING, VOTING_REFRESH_DEFAULT_MINUTES);
  checkEveryMinutes = typeof value === "number" && value >= 1 && value <= VOTING_REFRESH_DEFAULT_MINUTES ? value : VOTING_REFRESH_DEFAULT_MINUTES;
}

/** Cadence reads the installed Admin value on each pass, including a faster final-week check. */
export function votingDoorRefreshCadence(electionDate: string): RoutineCadencePolicy {
  const electionMs = Date.parse(`${electionDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(electionDate) || !Number.isFinite(electionMs) ||
    new Date(electionMs).toISOString().slice(0, 10) !== electionDate) throw new Error("VOTING_ELECTION_DATE_INVALID");
  return { description: "Voting sources twice daily; hourly during the final week through Election Day",
    get defaultEveryMs() { return checkEveryMinutes * MINUTE; },
    phases: [
      { through: new Date(electionMs - 7 * DAY).toISOString(), get everyMs() { return checkEveryMinutes * MINUTE; }, description: "Twice daily before the final week" },
      { through: new Date(electionMs + DAY + 12 * 60 * MINUTE).toISOString(), get everyMs() { return Math.min(60, checkEveryMinutes) * MINUTE; }, description: "Hourly through Election Day" },
    ] };
}
