import "server-only";

/**
 * Each state's Census universe (`scripts/build-state-census-denominators.mts`),
 * about 18 KB, imported whole so every Admin page can name what a state holds
 * before anything in it is registered.
 */
import denominators from "./state-census-denominators.json";
import type { CensusStateEntry } from "@/lib/control-plane/admin-view/census-universe.ts";

const STATES = (denominators as unknown as { readonly states: Readonly<Record<string, CensusStateEntry>> }).states;

/** A state's Census universe by its USPS code (any case), or null when the file holds no row for it. */
export function censusEntryOf(code: string): CensusStateEntry | null {
  return STATES[code.toUpperCase()] ?? null;
}
