import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localElectionOfficeCoverage, type LocalElectionOfficeRoster } from "../lib/reference/local-election-office-coverage.ts";
import type { LocalElectionOfficeFile } from "../lib/sources/local-election-offices/model.ts";
import { LOCAL_ELECTION_OFFICES_STATES } from "../lib/sources/local-election-offices/targets.ts";
import type { RegistrationReference } from "../lib/registration/reference.ts";

const args = process.argv.slice(2);
const option = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = option("root");
if (!root) throw new Error("Use --root=<directory of state JSON files>; this check never reads or writes production.");
const groups = (option("groups") ?? "").split(",").filter(Boolean);
const reports = [];
for (const state of LOCAL_ELECTION_OFFICES_STATES) {
  const key = state.toLowerCase();
  const paths = [resolve(root, `${key}.json`), ...groups.map(group => resolve(root, group, `${key}.json`))].filter(existsSync);
  if (paths.length > 1) throw new Error(`More than one office file for ${state}; choose its current state partition.`);
  const file = paths[0] ? JSON.parse(readFileSync(paths[0], "utf8")) as LocalElectionOfficeFile : null;
  const rosterPath = resolve(root, "rosters", `${key}.json`);
  const roster = existsSync(rosterPath) ? JSON.parse(readFileSync(rosterPath, "utf8")) as LocalElectionOfficeRoster : undefined;
  const reference = JSON.parse(readFileSync(resolve("data/derived/registration", `${key}.json`), "utf8")) as RegistrationReference;
  reports.push(localElectionOfficeCoverage(state, reference.divisions, file, roster));
}
if (option("out")) writeFileSync(resolve(option("out")!), `${JSON.stringify(reports, null, 2)}\n`);
console.log(JSON.stringify(reports.map(({ missing, missingFields, missingSources, unreconciledGeographies, ...summary }) => ({ ...summary,
  missingJurisdictions: missing?.length ?? null, unreconciledGeographies: unreconciledGeographies.length, missingFields: missingFields.length, missingSources: missingSources.length }))));
process.exitCode = reports.every(report => report.complete) ? 0 : 2;
