/**
 * The one import of today's doors, through the same upserts every derive step
 * uses, so a second run changes nothing and a newer hand edit is kept. The
 * runner seeds only when `WTP_DOORS_SEED=on` and the registry holds no doors.
 */

import { readDerivedMeetingWiring, type DerivedWiringRecord } from "../civic-data/derived-meeting-wiring.ts";
import { ROUTE_HINTS } from "../hunt/meetings-route-hints.ts";
import { SOURCE_WIRING } from "../registry/source-wiring.ts";
import { listDoors, type DoorRepository } from "./registry.ts";
import { seedRouteHintDoors } from "./route-hints.ts";
import { seedFeedDoors } from "./seed-feeds.ts";
import { seedMeetingDoors } from "./seed-meetings.ts";

export const DOORS_SEED_SWITCH = "WTP_DOORS_SEED";

export interface SeedCounts {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly keptManualEdit: number;
  readonly refused: readonly string[];
}

export interface SeedAllResult {
  readonly meetings: SeedCounts;
  readonly feeds: SeedCounts;
  readonly routeHints: SeedCounts;
  readonly derivedNote: string;
  readonly total: number;
}

export function doorSeedOnFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[DOORS_SEED_SWITCH]?.trim().toLowerCase() === "on";
}

/** Derived rows come from the promoted wiring; when it cannot be read the hand-wired doors still import. */
export async function readDerivedForSeed(now: string): Promise<{ records: readonly DerivedWiringRecord[]; note: string }> {
  try {
    const read = await readDerivedMeetingWiring({ bypassCache: true, now });
    if (read.kind === "PROMOTED") return { records: read.value.records, note: `${read.value.records.length} derived rows read from the promoted wiring.` };
    return { records: [], note: `derived rows were not read (${read.kind}).` };
  } catch {
    return { records: [], note: "derived rows were not read: the promoted wiring could not be read here." };
  }
}

export async function seedAllDoors(input: {
  readonly repo: DoorRepository;
  readonly derived: readonly DerivedWiringRecord[];
  readonly derivedNote?: string;
  readonly now: string;
}): Promise<SeedAllResult> {
  const { repo, now } = input;
  const meetings = await seedMeetingDoors({ repo, wiring: SOURCE_WIRING, derived: input.derived, deriveInputAt: now, at: now });
  const feeds = await seedFeedDoors({ repo, deriveInputAt: now, at: now });
  const routeHints = await seedRouteHintDoors({ repo, hints: ROUTE_HINTS, deriveInputAt: now, at: now });
  return { meetings, feeds, routeHints, derivedNote: input.derivedNote ?? "", total: (await listDoors(repo)).doors.length };
}

export type SeedOnStart =
  | { readonly seeded: false; readonly reason: string }
  | { readonly seeded: true; readonly result: SeedAllResult };

/** Runner start: seed an empty registry once, behind the switch. Never throws. */
export async function seedDoorsOnStart(
  repo: DoorRepository,
  options: { readonly env?: Readonly<Record<string, string | undefined>>; readonly now?: string } = {},
): Promise<SeedOnStart> {
  if (!doorSeedOnFromEnv(options.env)) return { seeded: false, reason: `${DOORS_SEED_SWITCH} is not on` };
  try {
    const held = (await listDoors(repo)).doors.length;
    if (held > 0) return { seeded: false, reason: `the registry already holds ${held} doors` };
    const now = options.now ?? new Date().toISOString();
    const derived = await readDerivedForSeed(now);
    return { seeded: true, result: await seedAllDoors({ repo, derived: derived.records, derivedNote: derived.note, now }) };
  } catch (error) {
    return { seeded: false, reason: `seeding failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
