import { ROUTINE_JOBS } from "../civic-data/routine-jobs.ts";
import { runnerFamilyLabel, runnerReadFamily } from "../db/runner-read-families.ts";

const NAMED: Readonly<Record<string, string>> = {
  "saved-keys": "Saved key checks",
  ...Object.fromEntries(Object.values(ROUTINE_JOBS).map(job => [job.id, job.label])),
  "door-probes": "Hourly door checks", "release-install": "Release install", "place-pages": "Place pages", "place-files": "Place files", "slices": "Place slices", "parser-lane": "Page readers", "hunter-lane": "Hunters", "intake-runtime": "Intake checks", "platform-census": "Website platform census",
  "research-cycle": "Paid research rounds", "people-portraits": "Portraits", "place-map": "Place maps", "voting-sites": "Voting places",
  "registration": "Voter registration", "legistar-members": "Legistar members", "meeting-partition": "Meeting calendar",
  "meeting-doors": "Meeting doors", "audit-pass": "Audit pass", "console-publish": "Console publishing", "member-offices": "Member offices",
};
const STATES = new Set("al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy as gu mp pr vi".split(" "));

/** A job's name in plain words, with its state when it runs per state. Its id stays behind Technical details. */
export function jobLabel(job: string): string {
  if (NAMED[job]) return NAMED[job];
  const family = runnerReadFamily(job);
  const [head, after] = job.split(":");
  const state = [after, head.split("-").at(-1), head.split("-")[0]].find(part => part !== undefined && STATES.has(part.toLowerCase()) && head !== part);
  const name = NAMED[family] ?? runnerFamilyLabel(family);
  return state ? `${name} · ${state.toUpperCase()}` : name;
}

/** The data a job read most, in words: "civic_data_candidates:MEETING" reads as "civic data candidates (meeting)". */
export function tableWords(table: string | null): string | null {
  if (!table) return null;
  const [name, kind] = table.split(",")[0]!.split(":");
  const words = name!.replace(/^cp_/, "").replaceAll("_", " ");
  return kind ? `${words} (${kind.toLowerCase().replaceAll("_", " ")})` : words;
}
