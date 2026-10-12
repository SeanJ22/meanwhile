/**
 * Every door the system already holds, kept in the registry on every runner
 * pass: the hand-wired meeting doors moved out of code (the one-time door
 * import, `data/doors/hand-wired-meeting-doors.json`), the promoted derived
 * wiring, the feeds, the route hints, and the sources Scouts and detectives
 * found. Each goes through the same upserts every derive step uses, so a pass
 * with nothing new writes nothing and a hand edit made since is kept. Sources
 * found after this are added as they are recorded (`recordFoundSources`).
 */

import { readDerivedMeetingWiring, type DerivedWiringRecord } from "../civic-data/derived-meeting-wiring.ts";
import type { AppendOnlyRepository, Persisted } from "../control-plane/repository/types.ts";
import type { ScoutResult } from "../control-plane/scheduler/scout-result.ts";
import { ROUTE_HINTS } from "../hunt/meetings-route-hints.ts";
import { readFileSync } from "node:fs";
import type { BodySourceWiring } from "../registry/source-wiring.ts";
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
  /** The hand-wired meeting doors moved out of code. */
  readonly imported: SeedCounts;
  /** The derived meeting doors. */
  readonly meetings: SeedCounts;
  readonly feeds: SeedCounts;
  readonly routeHints: SeedCounts;
  /** Null when found sources were already held, so the scout log was not read. */
  readonly found: PageDoorsResult | null;
  readonly derivedNote: string;
  readonly total: number;
}

/**
 * The one-time door import: the hand-wired meeting doors that lived only in code, moved into the registry. Read by
 * the import alone; deleted once production confirms the import. Its time is when the rows were taken from code, so
 * a door edited in the registry since keeps its edit.
 */
export const DOOR_IMPORT_PATH = "data/doors/hand-wired-meeting-doors.json";
export function readDoorImport(root = process.cwd()): { readonly generatedAt: string; readonly rows: readonly BodySourceWiring[] } {
  const file = JSON.parse(readFileSync(`${root}/${DOOR_IMPORT_PATH}`, "utf8")) as { generatedAt?: unknown; rows?: unknown };
  if (typeof file.generatedAt !== "string" || !Number.isFinite(Date.parse(file.generatedAt)) || !Array.isArray(file.rows)) {
    throw new Error(`${DOOR_IMPORT_PATH} is not a door import`);
  }
  return { generatedAt: file.generatedAt, rows: file.rows as BodySourceWiring[] };
}

/** Derived rows come from the promoted wiring, timed at its promotion; when it cannot be read the other doors still import. */
export async function readDerivedForSeed(now: string): Promise<{ records: readonly DerivedWiringRecord[]; note: string; at: string }> {
  try {
    const read = await readDerivedMeetingWiring({ bypassCache: true, now });
    if (read.kind === "PROMOTED") {
      return { records: read.value.records, note: `${read.value.records.length} derived rows read from the promoted wiring.`, at: read.metadata.promotedAt ?? now };
    }
    return { records: [], note: `derived rows were not read (${read.kind}).`, at: now };
  } catch {
    return { records: [], note: "derived rows were not read: the promoted wiring could not be read here.", at: now };
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
  readonly imported: { readonly generatedAt: string; readonly rows: readonly BodySourceWiring[] };
  readonly derived: readonly DerivedWiringRecord[];
  /** When the derived rows were promoted. */
  readonly derivedAt?: string;
  readonly derivedNote?: string;
  /** The scout log, read in full only while the registry holds no found source yet. */
  readonly scoutResults?: Pick<AppendOnlyRepository<ScoutResult>, "readAll">;
  readonly now: string;
}): Promise<SeedAllResult> {
  const { now } = input;
  const rows = await input.repo.list();
  const repo = readFromListing(input.repo, rows);
  // Feeds and route hints come with the code, as the import does: a hand edit made since is kept.
  const codeAt = input.imported.generatedAt;
  const imported = await seedMeetingDoors({ repo, wiring: input.imported.rows, derived: [], deriveInputAt: codeAt, at: now });
  const meetings = await seedMeetingDoors({ repo, wiring: [], derived: input.derived, deriveInputAt: input.derivedAt ?? now, at: now });
  const feeds = await seedFeedDoors({ repo, deriveInputAt: codeAt, at: now });
  const routeHints = await seedRouteHintDoors({ repo, hints: ROUTE_HINTS, deriveInputAt: codeAt, at: now });
  const found = input.scoutResults !== undefined && !rows.some(isFoundSource)
    ? await recordFoundSources(repo, await input.scoutResults.readAll(), now)
    : null;
  const total = rows.length + imported.created + meetings.created + feeds.created + routeHints.created + (found?.created ?? 0);
  return { imported, meetings, feeds, routeHints, found, derivedNote: input.derivedNote ?? "", total };
}

export type DoorSync =
  | { readonly synced: false; readonly reason: string }
  | { readonly synced: true; readonly result: SeedAllResult };

/** One runner pass: bring every held door into the registry. Never throws. */
export async function syncHeldDoors(
  repo: DoorRepository,
  options: {
    readonly scoutResults?: Pick<AppendOnlyRepository<ScoutResult>, "readAll">;
    readonly now?: string;
    readonly imported?: { readonly generatedAt: string; readonly rows: readonly BodySourceWiring[] };
  } = {},
): Promise<DoorSync> {
  try {
    const now = options.now ?? new Date().toISOString();
    const derived = await readDerivedForSeed(now);
    return { synced: true, result: await seedAllDoors({ repo, imported: options.imported ?? readDoorImport(), derived: derived.records, derivedAt: derived.at,
      derivedNote: derived.note, scoutResults: options.scoutResults, now }) };
  } catch (error) {
    return { synced: false, reason: `the doors could not be brought up to date: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One line for the runner log. */
export function doorSyncLine(sync: DoorSync): string {
  if (!sync.synced) return sync.reason;
  const { imported, meetings, feeds, routeHints, found, total } = sync.result;
  const parts = [imported, meetings, feeds, routeHints, ...(found === null ? [] : [found])];
  const created = parts.reduce((sum, part) => sum + part.created, 0);
  const updated = parts.reduce((sum, part) => sum + part.updated, 0);
  const refused = [imported, meetings, feeds, routeHints].reduce((sum, part) => sum + part.refused.length, 0);
  return `${total} doors held; ${created} added, ${updated} updated this pass${refused > 0 ? `, ${refused} refused` : ""}; ` +
    `door import: ${imported.created} added, ${imported.updated} updated, ${imported.unchanged} already there, ${imported.keptManualEdit} kept their hand edit`;
}
