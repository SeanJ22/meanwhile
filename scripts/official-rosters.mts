/** One current official source. The continuous runner owns the daily clock and Admin's next-pass reads. */
import { pathToFileURL } from "node:url";
import { acquireOfficialRoster } from "../lib/sources/official-rosters/index.ts";
import { OFFICIAL_ROSTER_TARGETS } from "../lib/sources/official-rosters/targets.ts";
import { publishOfficialRoster } from "../lib/civic-data/official-roster-publication.ts";
import { readOpenStatesPeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { statePeopleDivisions } from "../lib/sources/plural/acquisition.ts";
import { attachOfficialRosterDivisions } from "../lib/officials/roster-divisions.ts";

export async function refreshOfficialRoster(input: {
  readonly targetId: string; readonly store: RoutineDataStore; readonly now?: () => string; readonly acquire?: typeof acquireOfficialRoster;
}) {
  const target = OFFICIAL_ROSTER_TARGETS.find(row => row.id === input.targetId);
  if (!target) throw new Error("OFFICIAL_ROSTER_TARGET_UNKNOWN");
  const clock = input.now ?? (() => new Date().toISOString());
  const acquired = await withPublisherAcquisitionDeadline(target.publisher, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
    signal => (input.acquire ?? acquireOfficialRoster)({targetId: target.id, signal, refresh: true}));
  if (!acquired.roster.officeholders.length && !acquired.roster.vacancies?.length) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", acquired.gaps.map(row => row.detail).join("; ") || "The official roster supplied no verified records.");
  // A missing mirror cannot delay independently verified official facts.
  let mirror = null;
  try {
    if (target.jurisdiction === "US") {
      const read = await readFederalDirectoryProjection({store: input.store, now: clock(), bypassCache: true});
      if (read.kind === "PROMOTED") mirror = read.value.roster;
    } else {
      const read = await readOpenStatesPeopleProjection(target.jurisdiction as `US-${string}`, {store: input.store, now: clock(), bypassCache: true});
      if (read.kind === "PROMOTED") mirror = read.value.roster;
    }
  } catch { /* The source's own saved bytes are enough under §3. */ }
  let roster = acquired.roster;
  let geography;
  if (target.state) {
    try {
      const read = await statePeopleDivisions(target.state.toLowerCase(), clock());
      if (read.kind === "HELD") {
        geography = {versionId: read.versionId, divisions: read.value};
        roster = attachOfficialRosterDivisions(roster, target.state, read.value);
      }
    } catch { /* Independently verified people remain readable while geometry is still owed. */ }
  }
  const unresolvedVacancies = roster.vacancies?.filter(row => !row.divisionId) ?? [];
  if (unresolvedVacancies.length) roster = {...roster, vacancies: roster.vacancies?.filter(row => row.divisionId)};
  return publishOfficialRoster({...acquired, roster, geography, mirror,
    gaps: [...acquired.gaps, ...unresolvedVacancies.map(row => ({sourceUrl: row.provenance.sourceUrl!, detail: `The source states ${row.officeTitle}, ${row.district}: vacant${row.since ? ` since ${row.since}` : ""}; its Census division is still being matched.`}))],
    now: clock(), store: input.store});
}

async function main() {
  const args = process.argv.slice(2), targetId = args.find(arg => arg.startsWith("--target="))?.slice(9);
  if (args.length !== 2 || !args.includes("--promote") || !targetId) throw new Error("One --target and --promote are required.");
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  try {
    const {candidate, outcome} = await refreshOfficialRoster({targetId, store});
    printSourceRunnerReceipt(targetId, candidate, outcome);
    if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
  } catch (error) {
    const target = OFFICIAL_ROSTER_TARGETS.find(row => row.id === targetId);
    if (!target) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({store, contractId: targetId, requestedUrl: target.routes[0],
      failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", error instanceof Error ? error.message : String(error))});
    console.log(failed.line); process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
