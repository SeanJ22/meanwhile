import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { factReader } from "../facts/db.ts";
import { readPlacePackage, type AgendaDocumentLink } from "../reader/place.ts";
import { divisionOf, meetingStateOf } from "./body-scope.ts";
import { MEETINGS_RECORD_CLASS, MEETINGS_SCOPE, MEETINGS_SOURCE_ID, snapshotCounts,
  type MeetingsProjectionReadResult, type MeetingsSnapshot } from "./snapshot.ts";
import type { MeetingSettings } from "./settings.ts";
import { readReaderMeetingSettings } from "./reader-settings.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { combineStateRegistries } from "../registry/state-composition.ts";
import type { Query } from "../facts/publish.ts";

export async function readReaderEdgeMeetings(options: ReaderMeetingsOptions = {}): Promise<MeetingsProjectionReadResult> {
  const [selected, settings] = await Promise.all([readPlaceMeetings(options), options.settings ?? readReaderMeetingSettings()]);
  const read = applyServedWindow(selected.read, options.window ?? "SHOWN", options.now, settings);
  if (selected.context && (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP")) {
    const ids = new Set(read.value.meetings.map(meeting => meeting.id));
    options.onContext?.({...selected.context,agendaDocumentLinks:selected.context.agendaDocumentLinks.filter(link => ids.has(link.meetingId))});
  }
  return read;
}

export interface ReaderMeetingsContext {
  readonly registry: RegistryRuntimeReadModel | null;
  readonly states: readonly string[];
  readonly agendaDocumentLinks: readonly AgendaDocumentLink[];
}

/** `SHOWN`: the configured shown window. `HELD`: every kept past meeting plus the shown window ahead. */
export type ReaderMeetingsWindow = "SHOWN" | "HELD";

const servedWindows = new WeakMap<object, Map<string, MeetingsProjectionReadResult>>();

function applyServedWindow(
  read: MeetingsProjectionReadResult,
  window: ReaderMeetingsWindow,
  nowOption: string | undefined,
  settings: MeetingSettings,
): MeetingsProjectionReadResult {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return read;
  const now = nowOption ? Date.parse(nowOption) : Date.now();
  if (!Number.isFinite(now)) return read;
  const day = 86_400_000;
  const key = `${window}:${now}:${settings.shownBackDays}:${settings.shownAheadDays}`;
  const memo = servedWindows.get(read) ?? new Map<string, MeetingsProjectionReadResult>();
  const hit = memo.get(key);
  if (hit) return hit;
  const lower = window === "HELD" ? Number.NEGATIVE_INFINITY : now - settings.shownBackDays * day;
  const upper = now + settings.shownAheadDays * day;
  const meetings = read.value.meetings.filter((meeting) => {
    const startsAt = Date.parse(meeting.startsAt);
    return !Number.isFinite(startsAt) || (startsAt >= lower && startsAt <= upper);
  });
  let served = read;
  if (meetings.length !== read.value.meetings.length) {
    const kept = new Set(meetings.map(({ id }) => id));
    served = {
      ...read,
      value: {
        ...read.value,
        meetings,
        agendaDocuments: read.value.agendaDocuments.filter((document) => kept.has(document.meetingId)),
        counts: snapshotCounts(meetings, read.value.counts.duplicatesCollapsed ?? 0),
      },
    };
  }
  memo.set(key, served);
  if (memo.size > 4) memo.delete([...memo.keys()][0]!);
  servedWindows.set(read, memo);
  return served;
}

/** A read names the place it is for (divisions) or the bodies it wants; it never asks for the country. */
type ReaderMeetingsOptions = {
    readonly states?: readonly string[];
    readonly ocdIds?: readonly string[];
    readonly bodyIds?: readonly string[];
    /** With `bodyIds`: also the bodies that serve any division those bodies serve, so shared documents are seen against their neighbours. */
    readonly neighbors?: boolean;
    readonly includeAgenda?: boolean;
    /** Select the opened sitting with the merge, identity and document-ownership context its agenda needs. */
    readonly meetingIds?: readonly string[];
    readonly onContext?: (context: ReaderMeetingsContext) => void;
    readonly query?: Query;
    readonly now?: string;
    readonly window?: ReaderMeetingsWindow;
    readonly settings?: MeetingSettings;
  };

const NOT_A_PLACE: MeetingsProjectionReadResult = {
  kind: "NOT_RECORDED", value: null, detail: "A meetings read names a place or a body.",
  metadata: { recordClass: MEETINGS_RECORD_CLASS, scope: MEETINGS_SCOPE, sourceId: null, version: null, versionId: null, lastKnownGoodVersionId: null,
    sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "UNKNOWN", staleAt: null },
};

function meetingsUnreachable(detail: string): MeetingsProjectionReadResult {
  return { kind: "STORE_UNREACHABLE", value: null, metadata: NOT_A_PLACE.metadata, code: "STORE_READ_FAILED", detail };
}

export interface StateMeetingBody {
  readonly state: string;
  readonly bodyId: string;
  readonly load: () => Promise<{ readonly snapshot: MeetingsSnapshot } | null>;
}

function snapshotForBody(snapshot: MeetingsSnapshot, bodyId: string): MeetingsSnapshot {
  const meetings = snapshot.meetings.filter(meeting => meeting.bodyId === bodyId);
  const ids = new Set(meetings.map(meeting => meeting.id));
  return { ...snapshot, meetings, counts: snapshotCounts(meetings, 0),
    agendaDocuments: snapshot.agendaDocuments.filter(document => ids.has(document.meetingId)) };
}

/** State jobs read current facts and source partitions directly, one state at a time. */
export async function* readMeetingBodies(options: Pick<ReaderMeetingsOptions, "states" | "includeAgenda" | "window" | "settings" | "now">): AsyncGenerator<StateMeetingBody> {
  const settings = options.settings ?? await readReaderMeetingSettings();
  for (const state of options.states ?? [...REGISTRY_STATES, "US"]) {
    const held = await readPlacePackage({ state, divisionIds: [], allBodies: true, includeHistory: options.window === "HELD", includeAgenda: options.includeAgenda !== false });
    for (const body of held.bodies) yield { state, bodyId: body.id, load: async () => {
      const own = held.bodySnapshots[body.id] ?? snapshotForBody(held.snapshot, body.id);
      const value = options.includeAgenda === false ? { ...own, agendaDocuments: [] } : own;
      const read = applyServedWindow({ kind: "PROMOTED", value, metadata: NOT_A_PLACE.metadata, detail: "" },
        options.window ?? "SHOWN", options.now, settings);
      return read.kind === "PROMOTED" ? { snapshot: read.value } : null;
    } };
  }
}

export async function readHeldBodyIds(options: { readonly states: readonly string[] }): Promise<ReadonlySet<string>> {
  const query = factReader();
  if (!query) throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  const rows = await query("SELECT id FROM entity WHERE kind='body' AND state=ANY($1::text[])", [options.states.map(state => state.toUpperCase())]);
  return new Set(rows.map(row => String(row.id)));
}

async function readPlaceMeetings(options: ReaderMeetingsOptions): Promise<{read: MeetingsProjectionReadResult; context?: ReaderMeetingsContext}> {
  const divisions = [...new Set((options.ocdIds ?? []).map(divisionOf))];
  const bodyIds = [...new Set(options.bodyIds ?? [])];
  if (!divisions.length && !bodyIds.length) return {read:NOT_A_PLACE};
  const states = [...new Set([...(options.states ?? []).map(state => state.toUpperCase()),
    ...divisions.map(meetingStateOf), ...bodyIds.map(meetingStateOf)])];
  try {
    const packages = await Promise.all(states.map(state => readPlacePackage({ state, divisionIds: divisions, bodyIds,
      neighbors: options.neighbors, meetingIds: options.meetingIds,
      includeHistory: options.window === "HELD", includeAgenda: options.includeAgenda !== false }, options.query)));
    const registries = packages.flatMap(held => held.registry ? [held.registry] : []);
    const context: ReaderMeetingsContext = {states,
      registry:registries.length && registries.length === packages.length ? combineStateRegistries(registries) : null,
      agendaDocumentLinks:packages.flatMap(held => held.agendaDocumentLinks)};
    const snapshots = packages.map(held => held.snapshot);
    const meetings = snapshots.flatMap(snapshot => snapshot.meetings);
    const value: MeetingsSnapshot = { formatVersion: 1,
      generatedAt: snapshots.map(snapshot => snapshot.generatedAt).sort().at(-1) ?? options.now ?? new Date().toISOString(),
      meetings, sources: snapshots.flatMap(snapshot => snapshot.sources), counts: snapshotCounts(meetings, 0),
      agendaDocuments: options.includeAgenda === false ? [] : snapshots.flatMap(snapshot => snapshot.agendaDocuments) };
    return {read:{ kind: "PROMOTED", value, metadata: { ...NOT_A_PLACE.metadata, sourceId: MEETINGS_SOURCE_ID, stale: "CURRENT" },
      detail: `Read current facts and source calendars for ${states.join(", ")}.` },context};
  } catch (error) {
    return {read:meetingsUnreachable(error instanceof Error ? error.message : String(error))};
  }
}
