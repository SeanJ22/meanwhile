/**
 * Every door the system already holds, kept in the registry on every runner
 * pass: the wired meeting sources (hand wiring and the promoted derived
 * wiring), the feeds, the route hints, and the sources Scouts and detectives
 * found. Each goes through the same upserts every derive step uses, so a pass
 * with nothing new writes nothing and a newer hand edit is kept. Sources found
 * after this are added as they are recorded (`recordFoundSources`).
 */

import { readDerivedMeetingWiring, type DerivedWiringRecord } from "../civic-data/derived-meeting-wiring.ts";
import type { AppendOnlyRepository, Persisted } from "../control-plane/repository/types.ts";
import type { ScoutResult } from "../control-plane/scheduler/scout-result.ts";
import { ROUTE_HINTS } from "../hunt/meetings-route-hints.ts";
import { SOURCE_WIRING } from "../registry/source-wiring.ts";
import { PAGE_DOOR_KIND, recordFoundSources, type PageDoorsResult } from "./page-doors.ts";
import { isDoorRecord, type DoorRecord, type DoorRepository } from "./registry.ts";
import { seedRouteHintDoors } from "./route-hints.ts";
import { seedFeedDoors } from "./seed-feeds.ts";
import { seedMeetingDoors } from "./seed-meetings.ts";

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
  /** Null when found sources were already held, so the scout log was not read. */
  readonly found: PageDoorsResult | null;
  readonly derivedNote: string;
  readonly total: number;
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

/** Each door's first read comes from one listing; a door read again (after a write or a lost race) is read from the store. */
function readFromListing(repo: DoorRepository, rows: readonly Persisted<DoorRecord>[]): DoorRepository {
  const held = new Map(rows.map((row) => [row.id, row] as const));
  const served = new Set<string>();
  return Object.assign(Object.create(repo) as DoorRepository, {
    read: async (id: string) => {
      if (served.has(id)) return repo.read(id);
      served.add(id);
      return held.get(id) ?? null;
    },
  });
}

const isFoundSource = (row: Persisted<DoorRecord>): boolean =>
  isDoorRecord(row.value) && row.value.kind === PAGE_DOOR_KIND && typeof row.value.config.foundBy === "string";

export async function seedAllDoors(input: {
  readonly repo: DoorRepository;
  readonly derived: readonly DerivedWiringRecord[];
  readonly derivedNote?: string;
  /** The scout log, read in full only while the registry holds no found source yet. */
  readonly scoutResults?: Pick<AppendOnlyRepository<ScoutResult>, "readAll">;
  readonly now: string;
}): Promise<SeedAllResult> {
  const { now } = input;
  const rows = await input.repo.list();
  const repo = readFromListing(input.repo, rows);
  const meetings = await seedMeetingDoors({ repo, wiring: SOURCE_WIRING, derived: input.derived, deriveInputAt: now, at: now });
  const feeds = await seedFeedDoors({ repo, deriveInputAt: now, at: now });
  const routeHints = await seedRouteHintDoors({ repo, hints: ROUTE_HINTS, deriveInputAt: now, at: now });
  const found = input.scoutResults !== undefined && !rows.some(isFoundSource)
    ? await recordFoundSources(repo, await input.scoutResults.readAll(), now)
    : null;
  const total = rows.length + meetings.created + feeds.created + routeHints.created + (found?.created ?? 0);
  return { meetings, feeds, routeHints, found, derivedNote: input.derivedNote ?? "", total };
}

export type DoorSync =
  | { readonly synced: false; readonly reason: string }
  | { readonly synced: true; readonly result: SeedAllResult };

/** One runner pass: bring every held door into the registry. Never throws. */
export async function syncHeldDoors(
  repo: DoorRepository,
  options: { readonly scoutResults?: Pick<AppendOnlyRepository<ScoutResult>, "readAll">; readonly now?: string } = {},
): Promise<DoorSync> {
  try {
    const now = options.now ?? new Date().toISOString();
    const derived = await readDerivedForSeed(now);
    return { synced: true, result: await seedAllDoors({ repo, derived: derived.records, derivedNote: derived.note, scoutResults: options.scoutResults, now }) };
  } catch (error) {
    return { synced: false, reason: `the doors could not be brought up to date: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One line for the runner log. */
export function doorSyncLine(sync: DoorSync): string {
  if (!sync.synced) return sync.reason;
  const { meetings, feeds, routeHints, found, total } = sync.result;
  const parts = [meetings, feeds, routeHints, ...(found === null ? [] : [found])];
  const created = parts.reduce((sum, part) => sum + part.created, 0);
  const updated = parts.reduce((sum, part) => sum + part.updated, 0);
  const refused = [meetings, feeds, routeHints].reduce((sum, part) => sum + part.refused.length, 0);
  return `${total} doors held; ${created} added, ${updated} updated this pass${refused > 0 ? `, ${refused} refused` : ""}`;
}
