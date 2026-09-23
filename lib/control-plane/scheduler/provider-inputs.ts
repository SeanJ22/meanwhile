/**
 * **WHAT A STANDING PROVIDER IS HANDED, RATHER THAN WHAT IT HARDCODES.**
 * (MW-028, and the owner's direction of 2026-09-23: "This shouldn't be a code
 * change — new areas states will be added rapidly, it needs to be able to
 * track and keep up everywhere, not just a small subset.")
 *
 * Three readings a provider used to answer with a constant, each now read
 * from data and handed in:
 *
 * ```
 *   TrackedStatesSource        which states' registry work stands on a clock.
 *                              Was `REGISTERED_STATES = ["az","nh","nj"]` in
 *                              local-jurisdictions and `ENRICHED_STATES` in
 *                              candidate-enrichment. Now the coverage set.
 *                              Until the redesign's promoted coverage-set
 *                              accessor is on main, the interim source is the
 *                              promoted operational-reference bundle's own
 *                              registry keys: a state is tracked when its
 *                              registry has been promoted. Data, not code
 *   MeetingPartitionOwnership  whether a production meeting partition (the
 *                              one meetings clock, RULING 282/283) carries a
 *                              government's meetings. Was a blanket strip of
 *                              every MEETINGS route. The promoted source-wiring
 *                              reading is RouteTask's; until it is injected the
 *                              answer is UNKNOWN, and UNKNOWN holds a
 *                              machine-openable meetings route rather than risk
 *                              a second clock
 *   MaterializedReading        the obligations the owner's dispatch created
 *                              (MW-028), read back from the store so a provider
 *                              keeps them in its corpus
 * ```
 *
 * A reading that cannot be taken says so by name. It is never an empty list,
 * because an empty tracked set would retire every clock the provider owns and
 * an empty materialized set would do the same to the owner's created work.
 *
 * PURE apart from the interim tracked-state source, which reads the bundle the
 * runner already preloaded (no I/O of its own).
 */

import {
  requiredOperationalJurisdictionRegistry,
  requiredOperationalReferenceBundle,
} from "../../civic-data/operational-references.ts";
import type { JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";

/* ----------------------------------------------------------- tracked states */

export type TrackedStatesReading =
  | {
      /** Two-letter codes, lower-case, sorted, each once. */
      readonly states: readonly string[];
      /** Where the answer came from, in words a digest prints. */
      readonly source: string;
    }
  | { readonly unreadable: string; readonly source: string };

/** Which states' registry work stands on a clock. Read, never hardcoded. */
export interface TrackedStatesSource {
  read(): TrackedStatesReading;
}

const normalized = (states: readonly string[]): string[] =>
  [...new Set(states.map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2}$/.test(s)))].sort();

/**
 * The interim source: the states whose jurisdiction registry the promoted
 * operational-reference bundle carries. The runner preloads that bundle at
 * cycle start; a process that has not throws `OPERATIONAL_REFERENCE_READ_NOT_
 * INITIALIZED`, and the reading carries that sentence rather than a guess.
 */
export function trackedStatesFromOperationalReference(): TrackedStatesSource {
  const source = "the promoted operational-reference bundle (one jurisdiction registry per tracked state)";
  return {
    read() {
      try {
        const states = normalized(Object.keys(requiredOperationalReferenceBundle().registries));
        if (states.length === 0) {
          return { unreadable: "the promoted operational-reference bundle carries no registry at all — a failed read, never a country with no tracked state", source };
        }
        return { states, source };
      } catch (error) {
        return { unreadable: error instanceof Error ? error.message : String(error), source };
      }
    },
  };
}

/**
 * Every jurisdiction registry the promoted bundle carries, each read through
 * the ONE accessor the standing providers read it through
 * (`requiredOperationalJurisdictionRegistry`), and each one that accessor
 * refuses, with its reason. Planning work from a registry the providers cannot
 * read would create rows nothing keeps in the corpus, so a refused registry is
 * named — "promoted, and not read by this runtime" — never used and never
 * silently dropped. Keyed by lower-case state code.
 */
export function promotedRegistries():
  | { readonly registries: ReadonlyMap<string, JurisdictionRegistry>; readonly refused: ReadonlyMap<string, string> }
  | { readonly unreadable: string } {
  let states: string[];
  try {
    states = normalized(Object.keys(requiredOperationalReferenceBundle().registries));
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
  const registries = new Map<string, JurisdictionRegistry>();
  const refused = new Map<string, string>();
  for (const state of states) {
    try {
      registries.set(state, requiredOperationalJurisdictionRegistry(state));
    } catch (error) {
      refused.set(state, error instanceof Error ? error.message : String(error));
    }
  }
  return { registries, refused };
}

/**
 * A tracked set read elsewhere — the coverage set's own accessor, awaited by
 * the runner before the synchronous registry is built — handed in as a
 * snapshot. An empty list is refused by name for the reason in the header.
 */
export function trackedStatesFrom(states: readonly string[], source: string): TrackedStatesSource {
  const list = normalized(states);
  return {
    read: () =>
      list.length === 0
        ? { unreadable: `${source} names no tracked state — a failed read, never a country with no tracked state`, source }
        : { states: list, source },
  };
}

/* ------------------------------------------------------- meeting partitions */

/**
 * Who carries a government's production meetings clock.
 *
 *   PARTITION  a promoted source/body meeting partition carries it: a
 *              registry meetings route for that government is inventory
 *   NONE       the wiring was read and no partition carries it: a
 *              machine-openable registry meetings route is its only clock
 *   UNKNOWN    the wiring could not be read: a machine-openable meetings route
 *              is HELD, named, never scheduled beside a partition that may
 *              already own it
 */
export type MeetingRouteOwner = "PARTITION" | "NONE" | "UNKNOWN";

export interface MeetingPartitionOwnership {
  ownerOf(jurisdictionId: string): MeetingRouteOwner;
  readonly source: string;
}

/** Until the promoted source-wiring reading is injected, every answer is UNKNOWN. */
export const UNREAD_MEETING_PARTITIONS: MeetingPartitionOwnership = {
  ownerOf: () => "UNKNOWN",
  source: "no promoted source-wiring reading is handed to this process",
};

/* ------------------------------------------------------ the free discovery walk */

/**
 * What the free (deterministic, unpaid) discovery walk last recorded for a
 * government's meetings. The walk and its attempt log are the discovery
 * executor's (RouteTask); until that reading is handed in, every answer is
 * UNREAD.
 *
 *   FOUND             the free walk found where the meetings are published
 *   WALKED_NOT_FOUND  the free walk read the government's own site and did
 *                     not find them: only now may a paid Scout take it up
 *   NOT_WALKED        the free walk has not reached this government yet
 *   UNREAD            the attempt log could not be read, or is not wired
 */
export type FreeWalkOutcome = "FOUND" | "WALKED_NOT_FOUND" | "NOT_WALKED" | "UNREAD";

export interface FreeDiscoveryWalks {
  latestFor(jurisdictionId: string): FreeWalkOutcome;
  readonly source: string;
}

/** Until the discovery executor's attempt log is handed in, the free walk is UNREAD for everyone. */
export const UNREAD_FREE_DISCOVERY_WALKS: FreeDiscoveryWalks = {
  latestFor: () => "UNREAD",
  source: "no discovery-attempt log is handed to this process",
};

/* -------------------------------------------------- the owner's created work */

/** The obligation ids the owner's dispatch materialized, or why they could not be read. */
export type MaterializedReading =
  | { readonly ids: ReadonlySet<string> }
  | { readonly unreadable: string };

/** No dispatch has materialized anything: the default for a provider nobody wired. */
export const NOTHING_MATERIALIZED: MaterializedReading = { ids: new Set<string>() };
