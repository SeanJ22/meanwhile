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

/**
 * The exact division a subject is: a division itself (a body's `#` part dropped), or a registry government read
 * through its state's registration reference. Null for anything else; never widened to a state.
 */
export function subjectDivisionOf(subject: string, root = process.cwd()): string | null {
  const named = subject.trim().split("#")[0]!;
  if (named.toLowerCase().startsWith("ocd-division/")) return named;
  const state = /^([a-z]{2}):/i.exec(named)?.[1]?.toLowerCase();
  if (state === undefined) return null;
  const reference = referenceFor(state, root);
  const government = reference?.reference.governments.find((row) => row[1] === named);
  if (reference == null || government === undefined) return null;
  if (government[3] === "STATE") return stateDivision(state);
  return government[4] >= 0 ? reference.reference.divisions[government[4]]?.[0] ?? null : null;
}

/** The division a result's place names, or null when it names no one state. */
export function methodPlaceOf(jurisdiction: string, root = process.cwd()): string | null {
  const exact = subjectDivisionOf(jurisdiction, root);
  if (exact !== null) return exact;
  const state = /^([a-z]{2})(?:$|[:-])/i.exec(jurisdiction.trim())?.[1]?.toLowerCase();
  if (state === undefined || state === "us") return null;
  // A state with no registration reference is not one of the states this repository places.
  return referenceFor(state, root) === null ? null : stateDivision(state);
}
