import { basename, join } from "node:path";
import { readFileSync } from "node:fs";
import { heldRosterFiles, heldRosterStates, stateDomainFiles } from "../holdings/discovery.ts";
import { US_STATES } from "../control-plane/readiness/catalog.ts";
import { US_JURISDICTIONS, type StateIdentity } from "./states.ts";

/** Artifact availability is discovered per domain, never assigned by state. */
export function heldStatesForDomain(root: string, domain: string): StateIdentity[] {
  const held = new Set(stateDomainFiles(root, domain).map(file => file.split("/")[2]));
  return US_JURISDICTIONS.filter(state => held.has(state.slug));
}

export function rosterFile(state: Pick<StateIdentity, "fips">): string {
  return `officeholders-${state.fips}.json`;
}

export const NAME_BY_USPS: Readonly<Record<string, string>> = Object.fromEntries(
  US_STATES.map(state => [state.code.toUpperCase(), state.name]),
);

export function deriveArtifacts(root: string) {
  const rosters = heldRosterFiles(root);
  const ballotFiles = stateDomainFiles(root, "ballot").filter(file => file.endsWith(".json")).flatMap(file => {
    const value = JSON.parse(readFileSync(join(/* turbopackIgnore: true */ root, file), "utf8")) as { election?: { state?: string }; contests?: unknown[] };
    return value.election?.state?.toLowerCase() === file.split("/")[2] && Array.isArray(value.contests) ? [{ file: basename(file), state: value.election.state }] : [];
  });
  const states = heldRosterStates(root)
    .map(state => ({ ...state, name: NAME_BY_USPS[state.usps] ?? state.usps }));
  return {
    states,
    rosters,
    ballotFiles,
    geometryStates: heldStatesForDomain(root, "geo"),
  };
}

// Keep this literal build-time branch so the checkout is never traced into a production route.
const held = process.env.NODE_ENV === "production"
  ? { states: [], rosters: [], ballotFiles: [], geometryStates: [] }
  : deriveArtifacts(process.cwd());
export const HELD_ROSTER_STATES = held.states;
export const ROSTER_FILES: readonly string[] = held.rosters;
export const BALLOT_FILES: readonly { file: string; state: string }[] = held.ballotFiles;
export const HELD_GEOMETRY_FIPS = held.geometryStates.map(state => state.fips);
export const SLUG_BY_FIPS: Readonly<Record<string, string>> = Object.fromEntries(US_JURISDICTIONS.map(state => [state.fips, state.slug]));
export const USPS_BY_FIPS: Readonly<Record<string, string>> = Object.fromEntries(US_JURISDICTIONS.map(state => [state.fips, state.usps]));
