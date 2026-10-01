import { basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { stateDomainFiles } from "../holdings/files.ts";
import { readRecords } from "../reference/index.ts";
import { US_JURISDICTIONS, type StateIdentity } from "./states.ts";

/** Artifact availability is discovered per domain, never assigned by state. */
export function heldStatesForDomain(root: string, domain: string): StateIdentity[] {
  const held = new Set(stateDomainFiles(root, domain).map(file => file.split("/")[2]));
  return US_JURISDICTIONS.filter(state => held.has(state.slug));
}

export function rosterFile(state: Pick<StateIdentity, "fips">): string {
  return `officeholders-${state.fips}.json`;
}

/** Reference names are sourced geography data, separate from held artifacts. */
export const NAME_BY_USPS: Readonly<Record<string, string>> = Object.fromEntries(
  readRecords("acs5_2024_b01003_state").flatMap(row => {
    const state = US_JURISDICTIONS.find(state => state.fips === row.state_fips);
    return state ? [[state.usps, row.name]] : [];
  }),
);

export function deriveArtifacts(root: string) {
  const rosters = stateDomainFiles(root, "officials").filter(file =>
    US_JURISDICTIONS.some(state => file.split("/")[2] === state.slug && basename(file) === rosterFile(state)));
  const ballotFiles = stateDomainFiles(root, "ballot").filter(file => file.endsWith(".json")).flatMap(file => {
    const value = JSON.parse(readFileSync(join(root, file), "utf8")) as { election?: { state?: string }; contests?: unknown[] };
    return value.election?.state?.toLowerCase() === file.split("/")[2] && Array.isArray(value.contests) ? [{ file: basename(file), state: value.election.state }] : [];
  });
  const states = US_JURISDICTIONS.filter(state => rosters.some(file => basename(file) === rosterFile(state)))
    .map(state => ({ ...state, name: NAME_BY_USPS[state.usps] ?? state.usps }));
  return {
    states,
    rosters: [...(existsSync(join(root, "lib/registry/officeholders-us.json")) ? ["officeholders-us.json"] : []), ...rosters.map(file => basename(file))],
    ballotFiles,
    geometryStates: heldStatesForDomain(root, "geo"),
  };
}

const held = deriveArtifacts(process.cwd());
export const HELD_ROSTER_STATES = held.states;
export const ROSTER_FILES: readonly string[] = held.rosters;
export const BALLOT_FILES: readonly { file: string; state: string }[] = held.ballotFiles;
export const HELD_GEOMETRY_FIPS = held.geometryStates.map(state => state.fips);
export const SLUG_BY_FIPS: Readonly<Record<string, string>> = Object.fromEntries(US_JURISDICTIONS.map(state => [state.fips, state.slug]));
export const USPS_BY_FIPS: Readonly<Record<string, string>> = Object.fromEntries(US_JURISDICTIONS.map(state => [state.fips, state.usps]));
