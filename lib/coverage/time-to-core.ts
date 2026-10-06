/**
 * **TIME FROM MISSION START TO CORE INFORMATION LIVE (SC-19).** Design §3 sets a target: a county's core resident information is
 * live within an hour of the mission starting. "Core" is a setting that lists the core checklist items (starting value in
 * `core-items.ts`). For a sent place this measures the time from the mission's start until every core blank on its owed list is
 * satisfied, taking the moment each blank was first held and the latest of them as the moment the core was complete. A blank not yet
 * satisfied is counted and named, never assumed done; a place with no core blank owed yet has no figure. It only measures; it never
 * gates publishing. PURE.
 */
export interface CoreRow {
  readonly checklistId: string;
  readonly state: "published" | "held" | "unpublished" | "stale" | "missing";
  readonly held: readonly { readonly checkedAt: string }[];
  readonly statuses?: { readonly applies?: string; readonly due?: string } | null;
}

export interface CoreLive {
  readonly missionStart: string;
  /** Core blanks held, out of the core blanks owed and due now. */
  readonly n: number;
  readonly of: number;
  /** When the last core blank was first held; null until every one is. */
  readonly liveAt: string | null;
  /** Whole minutes from the mission start to `liveAt`, never below zero; null until live. */
  readonly minutes: number | null;
  /** Everything core was already held when the mission started, so the time is zero. */
  readonly alreadyHeld: boolean;
}

const earliest = (row: CoreRow): number | null => {
  const times = row.held.map((h) => Date.parse(h.checkedAt)).filter(Number.isFinite);
  return times.length === 0 ? null : Math.min(...times);
};

export function timeToCore(rows: readonly CoreRow[], coreIds: ReadonlySet<string>, missionStart: string | null): CoreLive | null {
  if (missionStart === null || !Number.isFinite(Date.parse(missionStart))) return null;
  // A blank that cannot be told to apply or to be due yet is not a core blank we can wait on; the government not publishing it ends the wait.
  const core = rows.filter((row) => coreIds.has(row.checklistId) && (row.statuses?.applies ?? "applies") !== "unresolved" && (row.statuses?.due ?? "due") === "due" && row.state !== "unpublished");
  if (core.length === 0) return null;
  const done = core.filter((row) => row.state === "published" || row.state === "held" || row.state === "stale");
  const start = Date.parse(missionStart);
  if (done.length < core.length) return { missionStart, n: done.length, of: core.length, liveAt: null, minutes: null, alreadyHeld: false };
  const times = done.map(earliest);
  if (times.some((t) => t === null)) return { missionStart, n: done.length, of: core.length, liveAt: null, minutes: null, alreadyHeld: false };
  const last = Math.max(...(times as number[]));
  return { missionStart, n: done.length, of: core.length, liveAt: new Date(last).toISOString(), minutes: Math.max(0, Math.round((last - start) / 60_000)), alreadyHeld: last <= start };
}
