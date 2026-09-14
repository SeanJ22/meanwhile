import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import type { FederalKeyVotesSnapshot } from "./data-plane.ts";
import {
  KEY_VOTES,
  KEY_VOTES_CRITERIA,
  PARKED_KEY_VOTES,
  type KeyVoteEntry,
  type RollCallRef,
} from "./key-votes.ts";

export const FEDERAL_KEY_VOTE_SELECTION_VERSION = "v1" as const;

interface SelectedRollIdentity {
  readonly congress: number;
  readonly session: number;
  readonly rollNumber: number;
}

interface SelectedQuestion {
  readonly id: string;
  readonly house: readonly SelectedRollIdentity[];
  readonly senate: readonly SelectedRollIdentity[];
}

/**
 * Reviewed selection v1. This is the only software-versioned part of the
 * key-vote product: question identities and the official rolls selected to
 * answer them. Official wording, tallies, URLs, verification times, and
 * member positions are deliberately absent and belong to the data plane.
 */
export const FEDERAL_KEY_VOTE_SELECTION_V1 = [
  { id: "cares-act", house: [], senate: [{ congress: 116, session: 2, rollNumber: 80 }] },
  { id: "american-rescue-plan", house: [{ congress: 117, session: 1, rollNumber: 72 }], senate: [{ congress: 117, session: 1, rollNumber: 110 }] },
  { id: "iija", house: [{ congress: 117, session: 1, rollNumber: 369 }], senate: [{ congress: 117, session: 1, rollNumber: 314 }] },
  { id: "bsca", house: [{ congress: 117, session: 2, rollNumber: 299 }], senate: [{ congress: 117, session: 2, rollNumber: 242 }] },
  { id: "chips", house: [{ congress: 117, session: 2, rollNumber: 404 }], senate: [{ congress: 117, session: 2, rollNumber: 271 }] },
  { id: "pact-act", house: [{ congress: 117, session: 2, rollNumber: 309 }], senate: [{ congress: 117, session: 2, rollNumber: 280 }] },
  { id: "ira", house: [{ congress: 117, session: 2, rollNumber: 420 }], senate: [{ congress: 117, session: 2, rollNumber: 325 }] },
  { id: "respect-for-marriage", house: [{ congress: 117, session: 2, rollNumber: 513 }], senate: [{ congress: 117, session: 2, rollNumber: 362 }] },
  { id: "fiscal-responsibility", house: [{ congress: 118, session: 1, rollNumber: 243 }], senate: [{ congress: 118, session: 1, rollNumber: 146 }] },
  { id: "april-2024-ukraine", house: [{ congress: 118, session: 2, rollNumber: 151 }], senate: [{ congress: 118, session: 2, rollNumber: 154 }] },
  { id: "april-2024-israel", house: [{ congress: 118, session: 2, rollNumber: 152 }], senate: [{ congress: 118, session: 2, rollNumber: 154 }] },
  { id: "april-2024-indopacific", house: [{ congress: 118, session: 2, rollNumber: 146 }], senate: [{ congress: 118, session: 2, rollNumber: 154 }] },
  { id: "april-2024-tiktok", house: [{ congress: 118, session: 2, rollNumber: 145 }], senate: [{ congress: 118, session: 2, rollNumber: 154 }] },
  { id: "ssfa", house: [{ congress: 118, session: 2, rollNumber: 456 }], senate: [{ congress: 118, session: 2, rollNumber: 338 }] },
  { id: "laken-riley", house: [{ congress: 119, session: 1, rollNumber: 23 }], senate: [{ congress: 119, session: 1, rollNumber: 7 }] },
  { id: "obbba", house: [{ congress: 119, session: 1, rollNumber: 190 }], senate: [{ congress: 119, session: 1, rollNumber: 372 }] },
  { id: "genius-act", house: [{ congress: 119, session: 1, rollNumber: 200 }], senate: [{ congress: 119, session: 1, rollNumber: 318 }] },
  { id: "funding-fight", house: [{ congress: 119, session: 1, rollNumber: 285 }], senate: [{ congress: 119, session: 1, rollNumber: 618 }] },
  { id: "road-to-housing", house: [{ congress: 119, session: 2, rollNumber: 224 }], senate: [{ congress: 119, session: 2, rollNumber: 182 }] },
  { id: "stock-trading-ban", house: [{ congress: 119, session: 2, rollNumber: 280 }], senate: [] },
  { id: "barrett-scotus", house: [], senate: [{ congress: 116, session: 2, rollNumber: 224 }] },
  { id: "becerra-hhs", house: [], senate: [{ congress: 117, session: 1, rollNumber: 125 }] },
  { id: "haaland-interior", house: [], senate: [{ congress: 117, session: 1, rollNumber: 119 }] },
  { id: "mayorkas-dhs", house: [], senate: [{ congress: 117, session: 1, rollNumber: 12 }] },
  { id: "garland-ag", house: [], senate: [{ congress: 117, session: 1, rollNumber: 114 }] },
  { id: "yellen-treasury", house: [], senate: [{ congress: 117, session: 1, rollNumber: 6 }] },
  { id: "buttigieg-dot", house: [], senate: [{ congress: 117, session: 1, rollNumber: 11 }] },
  { id: "powell-fed", house: [], senate: [{ congress: 117, session: 2, rollNumber: 176 }] },
  { id: "jackson-scotus", house: [], senate: [{ congress: 117, session: 2, rollNumber: 134 }] },
  { id: "hegseth-defense", house: [], senate: [{ congress: 119, session: 1, rollNumber: 15 }] },
  { id: "rfk-hhs", house: [], senate: [{ congress: 119, session: 1, rollNumber: 52 }] },
  { id: "gabbard-dni", house: [], senate: [{ congress: 119, session: 1, rollNumber: 50 }] },
  { id: "patel-fbi", house: [], senate: [{ congress: 119, session: 1, rollNumber: 61 }] },
  { id: "bondi-ag", house: [], senate: [{ congress: 119, session: 1, rollNumber: 33 }] },
  { id: "rubio-state", house: [], senate: [{ congress: 119, session: 1, rollNumber: 8 }] },
  { id: "blanche-doj", house: [], senate: [{ congress: 119, session: 2, rollNumber: 230 }] },
] as const satisfies readonly SelectedQuestion[];

function selectedRef(chamber: "house" | "senate", ref: SelectedRollIdentity): RollCallRef {
  const year = 1787 + (ref.congress * 2) + ref.session - 1;
  const url = chamber === "house"
    ? `https://clerk.house.gov/evs/${year}/roll${String(ref.rollNumber).padStart(3, "0")}.xml`
    : `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${ref.congress}${ref.session}/vote_${ref.congress}_${ref.session}_${String(ref.rollNumber).padStart(5, "0")}.xml`;
  return { ...ref, question: null, url, tally: null, verifiedAt: null };
}

function curatedEntry(entry: KeyVoteEntry, selected: SelectedQuestion): KeyVoteEntry {
  // Search phrases are reviewed acquisition hints, not official runtime facts
  // and not Reader output. Current pending/chamber status is also excluded:
  // it may enter a later schema only through a fresh official acquisition
  // represented in the durable receipt. The selected roll identities
  // supersede the old resolver hints here.
  const {
    lawSearch: _lawSearch,
    pending: _pending,
    pendingSearch: _pendingSearch,
    senateSearch: _senateSearch,
    senateNote: _senateNote,
    ...readerEntry
  } = structuredClone(entry);
  return {
    ...readerEntry,
    house: selected.house.map((ref) => selectedRef("house", ref)),
    senate: selected.senate.map((ref) => selectedRef("senate", ref)),
  };
}

function selectionShape(snapshot: FederalKeyVotesSnapshot): unknown {
  return {
    version: FEDERAL_KEY_VOTE_SELECTION_VERSION,
    criteria: snapshot.criteria,
    entries: snapshot.entries.map((entry) => {
      const {
        lawSearch: _lawSearch,
        pendingSearch: _pendingSearch,
        senateSearch: _senateSearch,
        ...readerEntry
      } = entry;
      return {
        ...readerEntry,
        house: entry.house.map(({ congress, session, rollNumber }) => ({ congress, session, rollNumber })),
        senate: entry.senate.map(({ congress, session, rollNumber }) => ({ congress, session, rollNumber })),
      };
    }),
  };
}

function rollIdentityShape(snapshot: FederalKeyVotesSnapshot): unknown {
  return snapshot.entries.map((entry) => ({
    id: entry.id,
    house: entry.house.map(({ congress, session, rollNumber }) => ({ congress, session, rollNumber })),
    senate: entry.senate.map(({ congress, session, rollNumber }) => ({ congress, session, rollNumber })),
  }));
}

/** Build the acquisition input from reviewed software, never from runtime facts. */
export function federalKeyVoteSelectionV1Snapshot(fetchedAt: string): FederalKeyVotesSnapshot {
  const selectedById = new Map<string, SelectedQuestion>(FEDERAL_KEY_VOTE_SELECTION_V1.map((entry) => [entry.id, entry]));
  if (selectedById.size !== FEDERAL_KEY_VOTE_SELECTION_V1.length || KEY_VOTES.length !== selectedById.size) {
    throw new Error("FEDERAL_KEY_VOTE_SELECTION_V1_DENOMINATOR_MISMATCH");
  }
  const entries = KEY_VOTES.map((entry) => {
    const selected = selectedById.get(entry.id);
    if (!selected) throw new Error(`FEDERAL_KEY_VOTE_SELECTION_V1_MISSING:${entry.id}`);
    if (PARKED_KEY_VOTES[entry.id] && (selected.house.length > 0 || selected.senate.length > 0)) {
      throw new Error(`FEDERAL_KEY_VOTE_SELECTION_V1_PARKED_WITH_ROLL:${entry.id}`);
    }
    return curatedEntry(entry, selected);
  });
  return { formatVersion: 1, fetchedAt, criteria: KEY_VOTES_CRITERIA, entries, misses: [] };
}

/** Validate that a promoted payload contains exactly the reviewed v1 selection. */
export function federalKeyVoteSelectionV1Issue(snapshot: FederalKeyVotesSnapshot): string | null {
  const expected = federalKeyVoteSelectionV1Snapshot(snapshot.fetchedAt);
  return canonicalCivicDataJson(selectionShape(snapshot)) === canonicalCivicDataJson(selectionShape(expected))
    ? null
    : "REVIEWED_KEY_VOTE_SELECTION_V1_MISMATCH";
}

/**
 * The bundled file contributes only its first-seed official facts. Reviewed
 * question copy comes from the versioned selection, so stale tracked copy can
 * neither override it nor become a second authority.
 */
export function hydrateFederalKeyVoteBootstrapV1(snapshot: FederalKeyVotesSnapshot): FederalKeyVotesSnapshot {
  const expected = federalKeyVoteSelectionV1Snapshot(snapshot.fetchedAt);
  if (canonicalCivicDataJson(rollIdentityShape(snapshot)) !== canonicalCivicDataJson(rollIdentityShape(expected))) {
    throw new Error("FEDERAL_KEY_VOTE_BOOTSTRAP_ROLL_SELECTION_MISMATCH");
  }
  return {
    formatVersion: 1,
    fetchedAt: snapshot.fetchedAt,
    criteria: expected.criteria,
    entries: expected.entries.map((entry, index) => ({
      ...entry,
      house: snapshot.entries[index].house,
      senate: snapshot.entries[index].senate,
    })),
    misses: snapshot.misses,
    ...(snapshot.lawMisses ? { lawMisses: snapshot.lawMisses } : {}),
  };
}
