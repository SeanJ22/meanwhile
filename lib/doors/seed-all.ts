import { readDerivedMeetingWiring, type DerivedWiringRecord } from "../civic-data/derived-meeting-wiring.ts";
import { REGISTRY_STATES, requireRegistryState, registryJurisdictions } from "../civic-data/state-scopes.ts";
import { ROUTE_HINTS } from "../hunt/meetings-route-hints.ts";
import { readFileSync } from "node:fs";
import type { BodySourceWiring } from "../registry/source-wiring.ts";
import type { CivicDataReadStore } from "../civic-data/read-model.ts";
import { type DoorRepository } from "./registry.ts";
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
  readonly derivedNote: string;
  readonly total: number;
}

export const DOOR_IMPORT_DIRECTORY = "data/doors/hand-wired-meeting-doors";
interface DoorImport { readonly generatedAt: string; readonly rows: readonly BodySourceWiring[] }
function readDoorImportInventory(root = process.cwd()): { readonly generatedAt: string; readonly states: readonly string[] } {
  const file = JSON.parse(readFileSync(`${root}/${DOOR_IMPORT_DIRECTORY}/states.json`, "utf8")) as { generatedAt?: unknown; states?: unknown };
  if (typeof file.generatedAt !== "string" || !Number.isFinite(Date.parse(file.generatedAt)) || !Array.isArray(file.states)) {
    throw new Error(`${DOOR_IMPORT_DIRECTORY}/states.json is not a door import inventory`);
  }
  return { generatedAt: file.generatedAt, states: file.states.map(state => requireRegistryState(state)) };
}
export function readDoorImport(state: string, root = process.cwd()): DoorImport {
  const selectedState = requireRegistryState(state);
  const path = `${DOOR_IMPORT_DIRECTORY}/${selectedState}.json`;
  const file = JSON.parse(readFileSync(`${root}/${path}`, "utf8")) as { generatedAt?: unknown; rows?: unknown };
  if (typeof file.generatedAt !== "string" || !Number.isFinite(Date.parse(file.generatedAt)) || !Array.isArray(file.rows)) {
    throw new Error(`${path} is not a door import`);
  }
  if (file.rows.some(row => !registryJurisdictions(row?.ocdId ?? row?.bodyId).includes(selectedState))) {
    throw new Error(`${path} holds a door outside ${selectedState}`);
  }
  return { generatedAt: file.generatedAt, rows: file.rows as BodySourceWiring[] };
}

/** Derived rows come from the promoted wiring, timed at its promotion; when it cannot be read the other doors still import. */
export async function readDerivedForSeed(now: string, state: string, store?: CivicDataReadStore): Promise<{ records: readonly DerivedWiringRecord[]; note: string; at: string }> {
  try {
    const read = await readDerivedMeetingWiring({ state, store, bypassCache: true, now });
    if (read.kind === "PROMOTED") {
      return { records: read.value.records, note: `${read.value.records.length} derived rows read from the promoted wiring.`, at: read.metadata.promotedAt ?? now };
    }
    return { records: [], note: `derived rows were not read (${read.kind}).`, at: now };
  } catch {
    return { records: [], note: "derived rows were not read: the promoted wiring could not be read here.", at: now };
  }
}

export async function seedAllDoors(input: {
  readonly repo: DoorRepository;
  readonly imported: { readonly generatedAt: string; readonly rows: readonly BodySourceWiring[] };
  readonly importedStates?: AsyncIterable<DoorImport>;
  readonly derived: readonly DerivedWiringRecord[];
  /** When the derived rows were promoted. */
  readonly derivedAt?: string;
  readonly derivedNote?: string;
  readonly derivedStates?: AsyncIterable<{ readonly records: readonly DerivedWiringRecord[]; readonly at: string; readonly note?: string }>;
  readonly now: string;
}): Promise<SeedAllResult> {
  const { now } = input;
  const repo = input.repo;
  let before = 0;
  if (repo.listChangedSince) await repo.listChangedSince(null, undefined, { projection: {}, page: rows => { before += rows.length; } });
  else before = (await repo.listNarrowed({})).length;
  // Feeds and route hints come with the code, as the import does: a hand edit made since is kept.
  const codeAt = input.imported.generatedAt;
  let imported = await seedMeetingDoors({ repo, wiring: input.imported.rows, derived: [], deriveInputAt: codeAt, at: now });
  if (input.importedStates) for await (const state of input.importedStates) {
    const next = await seedMeetingDoors({ repo, wiring: state.rows, derived: [], deriveInputAt: state.generatedAt, at: now });
    imported = { created: imported.created + next.created, updated: imported.updated + next.updated,
      unchanged: imported.unchanged + next.unchanged, keptManualEdit: imported.keptManualEdit + next.keptManualEdit,
      refused: [...imported.refused, ...next.refused] };
  }
  let meetings = await seedMeetingDoors({ repo, wiring: [], derived: input.derived, deriveInputAt: input.derivedAt ?? now, at: now });
  const derivedNotes = input.derivedNote ? [input.derivedNote] : [];
  if (input.derivedStates) for await (const state of input.derivedStates) {
    if (state.note) derivedNotes.push(state.note);
    const next = await seedMeetingDoors({ repo, wiring: [], derived: state.records, deriveInputAt: state.at, at: now });
    meetings = { created: meetings.created + next.created, updated: meetings.updated + next.updated,
      unchanged: meetings.unchanged + next.unchanged, keptManualEdit: meetings.keptManualEdit + next.keptManualEdit,
      refused: [...meetings.refused, ...next.refused] };
  }
  const feeds = await seedFeedDoors({ repo, deriveInputAt: codeAt, at: now });
  const routeHints = await seedRouteHintDoors({ repo, hints: ROUTE_HINTS, deriveInputAt: codeAt, at: now });
  const total = before + imported.created + meetings.created + feeds.created + routeHints.created;
  return { imported, meetings, feeds, routeHints, derivedNote: derivedNotes.join(" "), total };
}

export type DoorSync =
  | { readonly synced: false; readonly reason: string }
  | { readonly synced: true; readonly result: SeedAllResult };

/** One runner pass: bring every held door into the registry. Never throws. */
export async function syncHeldDoors(
  repo: DoorRepository,
  options: {
    readonly now?: string;
    readonly imported?: { readonly generatedAt: string; readonly rows: readonly BodySourceWiring[] };
    readonly derivedStore?: CivicDataReadStore;
  } = {},
): Promise<DoorSync> {
  try {
    const now = options.now ?? new Date().toISOString();
    const inventory = options.imported ? null : readDoorImportInventory();
    async function* imports() {
      for (const state of inventory?.states ?? []) yield readDoorImport(state);
    }
    async function* states() {
      for (const state of REGISTRY_STATES) {
        const read = await readDerivedForSeed(now, state, options.derivedStore);
        yield { records: read.records, at: read.at, note: `${state}: ${read.note}` };
      }
    }
    return { synced: true, result: await seedAllDoors({ repo, imported: options.imported ?? { generatedAt: inventory!.generatedAt, rows: [] }, importedStates: imports(), derived: [],
      derivedStates: states(), derivedNote: "Derived meeting doors read one state at a time.", now }) };
  } catch (error) {
    return { synced: false, reason: `the doors could not be brought up to date: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One line for the runner log. */
export function doorSyncLine(sync: DoorSync): string {
  if (!sync.synced) return sync.reason;
  const { imported, meetings, feeds, routeHints, total } = sync.result;
  const parts = [imported, meetings, feeds, routeHints];
  const created = parts.reduce((sum, part) => sum + part.created, 0);
  const updated = parts.reduce((sum, part) => sum + part.updated, 0);
  const refused = [imported, meetings, feeds, routeHints].reduce((sum, part) => sum + part.refused.length, 0);
  return `${total} doors held; ${created} added, ${updated} updated this pass${refused > 0 ? `, ${refused} refused` : ""}; ` +
    `door import: ${imported.created} added, ${imported.updated} updated, ${imported.unchanged} already there, ${imported.keptManualEdit} kept their hand edit`;
}
