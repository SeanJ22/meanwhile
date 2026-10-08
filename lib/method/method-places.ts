/**
 * Where a method's recorded result happened, as the division the fix map keys on. Results name their place in the
 * words their writer used: a division (`ocd-division/...`), a registry government (`az:city:town-of-marana`), another
 * subject of one state (a candidate, `az:2026:...`), a state (`az`), or a state's pilot (`az-pima-85641`). A
 * government is read through its state's committed registration reference to its own division; anything else of one
 * state is placed at that state. A result that names no one state (`us`, `pilot-counties`) has no place here.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadRegistrationReference, type LoadedReference } from "../registration/reference.ts";

const references = new Map<string, LoadedReference | null>();

function referenceFor(state: string, root: string): LoadedReference | null {
  const key = `${root}\u0000${state}`;
  if (!references.has(key)) {
    let loaded: LoadedReference | null = null;
    if (existsSync(join(/* turbopackIgnore: true */ root, "data", "derived", "registration", `${state}.json`))) {
      try {
        loaded = loadRegistrationReference(root, state);
      } catch {
        loaded = null;
      }
    }
    references.set(key, loaded);
  }
  return references.get(key)!;
}

const stateDivision = (state: string): string => `ocd-division/country:us/state:${state}`;

/** The division a result's place names, or null when it names no one state. */
export function methodPlaceOf(jurisdiction: string, root = process.cwd()): string | null {
  const named = jurisdiction.trim();
  if (named.toLowerCase().startsWith("ocd-division/")) return named.split("#")[0]!;
  const state = /^([a-z]{2})(?:$|[:-])/i.exec(named)?.[1]?.toLowerCase();
  if (state === undefined || state === "us") return null;
  const reference = referenceFor(state, root);
  // A state with no registration reference is not one of the states this repository places.
  if (reference === null) return null;
  const government = reference.reference.governments.find((row) => row[1] === named);
  if (government !== undefined && government[3] !== "STATE" && government[4] >= 0) {
    return reference.reference.divisions[government[4]]?.[0] ?? stateDivision(state);
  }
  return stateDivision(state);
}
