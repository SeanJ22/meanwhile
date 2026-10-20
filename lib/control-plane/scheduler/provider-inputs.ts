/**
 * What a standing provider is handed instead of hardcoding: tracked states, promoted registries, meeting
 * partition ownership, free discovery walks and the owner's materialized work. A reading that cannot be taken
 * says so by name and is never an empty list (an empty set would retire every clock the provider owns).
 */

import {
  installedRegistrationJurisdictionRegistries,
  installedOperationalReferenceStateCodes,
  requiredOperationalJurisdictionRegistry,
} from "../../civic-data/operational-references.ts";
import type { JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";


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

/** The interim source: the states whose registry the promoted operational-reference bundle carries. An uninitialized bundle is carried as the reading's sentence. */
export function trackedStatesFromOperationalReference(): TrackedStatesSource {
  const source = "the promoted operational-reference bundle (one jurisdiction registry per tracked state)";
  return {
    read() {
      try {
        const states = normalized(installedOperationalReferenceStateCodes());
        if (states.length === 0) {
          return { unreadable: "OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED: no promoted operational-reference registry was preloaded", source };
        }
        return { states, source };
      } catch (error) {
        return { unreadable: error instanceof Error ? error.message : String(error), source };
      }
    },
  };
}

/** Every registry the promoted bundle carries, read through `requiredOperationalJurisdictionRegistry`; one it refuses is named, never used. Keyed by lower-case state code. */
export function promotedRegistries():
  | { readonly registries: ReadonlyMap<string, JurisdictionRegistry>; readonly refused: ReadonlyMap<string, string> }
  | { readonly unreadable: string } {
  let states: string[];
  const registration = installedRegistrationJurisdictionRegistries();
  try {
    states = normalized(installedOperationalReferenceStateCodes());
    if (states.length === 0 && registration.registries.size === 0) throw new Error("OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED: no promoted jurisdiction registry was preloaded");
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
  /* Every other state a Send reached, read from its registration; one whose registration could not be read is named, never used. */
  for (const [state, registry] of registration.registries) if (!registries.has(state)) registries.set(state, registry);
  for (const [state, why] of registration.refused) if (!registries.has(state)) refused.set(state, why);
  return { registries, refused };
}

/** A tracked set read elsewhere, handed in as a snapshot. An empty list is refused by name. */
export function trackedStatesFrom(states: readonly string[], source: string): TrackedStatesSource {
  const list = normalized(states);
  return {
    read: () =>
      list.length === 0
        ? { unreadable: `${source} names no tracked state — a failed read, never a country with no tracked state`, source }
        : { states: list, source },
  };
}


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
  /** The same exact, conflict-free government/body join; no name or host inference. */
  bodyIdFor?(jurisdictionId: string): string | null;
  reasonFor?(jurisdictionId: string): string;
  readonly source: string;
}

/** Until the promoted source-wiring reading is injected, every answer is UNKNOWN. */
export const UNREAD_MEETING_PARTITIONS: MeetingPartitionOwnership = {
  ownerOf: () => "UNKNOWN",
  source: "no promoted source-wiring reading is handed to this process",
};


/**
 * What the free discovery walk last recorded for a government's meetings. Until a reading is handed in,
 * every answer is UNREAD. WALKED_NOT_FOUND and NO_SITE_TO_WALK let the paid lane take it up.
 */
export type FreeWalkOutcome = "FOUND" | "WALKED_NOT_FOUND" | "NOT_WALKED" | "NO_SITE_TO_WALK" | "UNREAD";

export interface FreeDiscoveryWalks {
  latestFor(jurisdictionId: string): FreeWalkOutcome;
  /**
   * What the free walk saw, as one line for a Scout's brief: its outcome and
   * the leads it could not confirm, so paid work starts from them. Evidence
   * only; the Scout still confirms. Null when there is nothing to say.
   */
  evidenceFor?(jurisdictionId: string): string | null;
  readonly source: string;
}

/** Until the discovery executor's attempt log is handed in, the free walk is UNREAD for everyone. */
export const UNREAD_FREE_DISCOVERY_WALKS: FreeDiscoveryWalks = {
  latestFor: () => "UNREAD",
  source: "no discovery-attempt log is handed to this process",
};


/** The obligation ids the owner's dispatch materialized, or why they could not be read. */
export type MaterializedReading =
  | { readonly ids: Iterable<string> & { readonly size: number; has(id: string): boolean } }
  | { readonly unreadable: string };

/** No dispatch has materialized anything: the default for a provider nobody wired. */
export const NOTHING_MATERIALIZED: MaterializedReading = { ids: new Set<string>() };
