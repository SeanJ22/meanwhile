import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { stateHoldingPath } from "./paths.ts";

const stateCodes = new Set(Object.values(FIPS_TO_STATE).map((entry) => entry.postal.toLowerCase()));

export function stateForFips(fips: string): string {
  const state = FIPS_TO_STATE[fips]?.postal.toLowerCase();
  if (!state) throw new Error(`Unknown state FIPS: ${fips}`);
  return state;
}

function assertFilename(file: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(file) || file.includes("..")) {
    throw new Error(`Invalid holding filename: ${file}`);
  }
}

/** Return a namespace component, keeping filesystem roots literal at the read site. */
export function stateForBallotFile(file: string): string | null {
  assertFilename(file);
  const state = /^([a-z]{2})-/.exec(file)?.[1];
  if (state && !stateCodes.has(state)) throw new Error(`Unknown ballot state: ${state}`);
  return state ?? null;
}

export function stateForRosterFile(file: string): string | null {
  assertFilename(file);
  if (file === "officeholders-us.json") return null;
  const fips = /^officeholders-(\d{2})\.json$/.exec(file)?.[1];
  if (!fips) throw new Error(`Invalid officeholder roster filename: ${file}`);
  return stateForFips(fips);
}

export function geometryPath(file: string): string {
  if (file.includes("/")) return file;
  const state = /-(\d{2})\.geojson$/.exec(file)?.[1];
  return state ? stateHoldingPath(stateForFips(state), "geo", file) : `public/geo/${file}`;
}

export function rosterPath(file: string): string {
  if (file.includes("/")) return file;
  const state = stateForRosterFile(file);
  return state ? stateHoldingPath(state, "officials", file) : `lib/registry/${file}`;
}

export function ballotPath(file: string): string {
  if (file.includes("/")) return file;
  const state = stateForBallotFile(file);
  return state ? stateHoldingPath(state, "ballot", file) : `data/ballot/${file}`;
}
