/**
 * **THE FIELD MANUAL — ONE GROWING STORE EVERY WORKER READS AND WRITES.**
 * (RULING 61: one living manifest that only grows. RULING 63: every run
 * inherits it and reports inherited-versus-newly-built. Owner directive
 * 2026-09-19: consolidate the scattered discovery knowledge into one store a
 * worker reads live and writes back live, with no human graduation step.)
 *
 * ## Why this store exists
 *
 * Learned discovery knowledge was scattered across ~20 stores in different
 * shapes — `data/method/knowledge.json` (frozen since Aug 31 because a human
 * had to run `method:learn` to admit anything), `cp_method_candidates` (scouts
 * wrote it and nobody read it), `lib/hunt/branch-manifest.ts`, the zip
 * playbook, the source ladder, the per-state dossiers, the vendor tenant
 * registries. A fleet whose knowledge does not carry forward is the same
 * worker run a thousand times. This store is the one place all of it lands so
 * that a worker born today is smarter than one born yesterday.
 *
 * ## Consolidation WITHOUT LOSS
 *
 * Every entry keeps its ORIGINAL SHAPE in `payload`, verbatim. `summary` is a
 * short projectable line a worker actually reads, and the typed hints
 * (`role`, `states`, `recordClasses`, `platforms`) are how the projection
 * narrows the store down to what applies — so a worker gets cents-of-cache
 * relevant lines rather than 70K tokens of the whole manifest. Two stores that
 * hold the same fact in different shapes become two entries; nothing is
 * dropped to look tidy.
 *
 * ## Grows only; live read, live write, no human step
 *
 * `upsertEntries` never removes an entry. A re-observation of the same id
 * refreshes its freshness/outcome and UNIONS its jurisdictions — it never
 * shrinks the store. A worker writes what it just learned straight in; the
 * next worker of any role reads it on its next walk. There is no admission
 * gate between the two.
 *
 * ## The two calls every role uses
 *
 * `readFieldManual(repos, query)` and `writeFieldManual(repos, entries, now)`
 * are the whole interface: a role reads the projection that applies to it, and
 * writes what it learned straight back. Everything above them is pure (no db,
 * fs, clock, or source-type imports) so the projection and grow-only rules are
 * tested without a database; the two calls take the repositories as an
 * argument, so this module still imports nothing that touches a store.
 */

import type { FixMapRow } from "../method/fix-map.ts";
import { hereNote, mergePlaceResults, methodHere, placeResultsOf, type PlaceResult } from "./field-manual-places.ts";
import { createHash } from "node:crypto";

import type { ControlPlaneRepositories } from "./repository/types.ts";
import { flushBankWriteFailures, recordBankWriteFailure } from "./bank-write-health.ts";
import { jobCostProfiles } from "./bank-job-cost.ts";

/** Every worker role whose learnings the manual carries. SHARED = every role reads it. */
export const FIELD_MANUAL_ROLES = [
  "SCOUT",
  "ACQUIRER",
  "PARSER",
  "DETECTIVE",
  "VALIDATOR",
  "AUDITOR",
  "ENGINEER",
  "SHARED",
] as const;
export type FieldManualRole = (typeof FIELD_MANUAL_ROLES)[number];

export type FieldManualOutcome = "YIELDED" | "ZERO" | "FAILED" | "BLOCKED" | "REFERENCE";

/**
 * One piece of learned knowledge, in a common envelope. `payload` is the
 * original record, preserved whole; everything else is the projectable index
 * over it. A "dead door" is an entry with outcome FAILED/BLOCKED — kept, never
 * deleted, because knowing a door is dead is itself learned knowledge.
 */
export interface FieldManualEntry {
  /** Deterministic from (source, key): a re-import updates rather than duplicates. */
  readonly id: string;
  readonly role: FieldManualRole;
  /** ROUTE | MANIFEST_BRANCH | PLATFORM_FINGERPRINT | DESCENT_SEED | BODY_RUNG | VENDOR_TENANT | SOURCE_REGISTER | PLAYBOOK | STATE_NOTE | SCOUT_CANDIDATE | ... */
  readonly kind: string;
  readonly title: string;
  /** ONE short line a worker reads. No newlines; kept well under a tweet so a projection of dozens still fits a cache. */
  readonly summary: string;
  /** Lowercase two-letter states this applies to. Empty = portable / any jurisdiction. */
  readonly states: readonly string[];
  /** Record classes / fields this bears on (e.g. "meetings", "campaignSite"). Empty = any. */
  readonly recordClasses: readonly string[];
  /** Vendor platforms this is about (e.g. "legistar", "civicplus"). Empty = any. */
  readonly platforms: readonly string[];
  /** Place scope. Division prefixes apply to their descendants; body IDs are exact. */
  readonly ocdIds?: readonly string[];
  readonly bodyIds?: readonly string[];
  readonly foundBy?: "SCOUT" | "DETECTIVE";
  /** The latest result anywhere, for display. What happened in each place is `placeResults` (DP-22). */
  readonly outcome: FieldManualOutcome;
  /** One result per place, so a result in one place never overwrites another's. Absent on entries written before DP-22. */
  readonly placeResults?: readonly PlaceResult[];
  /** The door itself, when the entry is one. */
  readonly url: string | null;
  /** Which original store this came from (path or table name). Provenance, never dropped. */
  readonly source: string;
  /** UTC YYYY-MM-DD or ISO, when known. Freshness only; never scheduling authority. */
  readonly observedAt: string | null;
  /** A0/A1/B/C tier where the source states one. */
  readonly tier: string | null;
  /** THE ORIGINAL RECORD, VERBATIM. Consolidation without loss lives here. */
  readonly payload: unknown;
}

export interface FieldManualStore {
  readonly formatVersion: 1;
  readonly updatedOn: string | null;
  readonly entries: readonly FieldManualEntry[];
}

export function emptyFieldManual(): FieldManualStore {
  return { formatVersion: 1, updatedOn: null, entries: [] };
}

/** A stable id, derived so a re-import of the same fact updates one row instead of forking it. */
export function fieldManualEntryId(source: string, key: string): string {
  return `fm-${createHash("sha256").update(`${source}|::|${key}`).digest("hex").slice(0, 24)}`;
}

function lower(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v !== ""))].sort();
}

/** Resolve scope from existing investigation/route payloads as well as new envelopes. */
export function fieldManualPlaceHints(payload: unknown): { states: string[]; ocdIds: string[]; bodyIds: string[] } {
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const outcomes = Array.isArray(p.outcomes) ? p.outcomes : [];
  const subjects = [p.subjectId, p.jurisdiction, ...outcomes.map(value => value && typeof value === "object" ? (value as Record<string, unknown>).jurisdiction : null)]
    .filter((value): value is string => typeof value === "string");
  const ocdIds = lower(subjects.filter(value => value.startsWith("ocd-division/")).map(value => value.split("#")[0]!));
  const states = lower(subjects.flatMap(value => {
    const state = /(?:state:|^)([a-z]{2})(?:\b|:)/i.exec(value)?.[1];
    return state ? [state] : [];
  }));
  const bodyIds = [...new Set([p.bodyId, ...(Array.isArray(p.bodyIds) ? p.bodyIds : [])].filter((value): value is string => typeof value === "string"))];
  return { states, ocdIds, bodyIds };
}

/** Normalise an entry's hint arrays so projection and dedup are order-insensitive. */
export function normalizeEntry(entry: FieldManualEntry): FieldManualEntry {
  const place = ["INVESTIGATION_RESULT", "ROUTE", "SCOUT_DISCOVERY", "SOURCE_DEAD_END"].includes(entry.kind)
    ? fieldManualPlaceHints(entry.payload) : { states: [], ocdIds: [], bodyIds: [] };
  return {
    ...entry,
    states: lower([...entry.states, ...place.states]),
    ...((entry.ocdIds || place.ocdIds.length) ? { ocdIds: lower([...(entry.ocdIds ?? []), ...place.ocdIds]) } : {}),
    ...((entry.bodyIds || place.bodyIds.length) ? { bodyIds: [...new Set([...(entry.bodyIds ?? []), ...place.bodyIds])].sort() } : {}),
    recordClasses: lower(entry.recordClasses),
    platforms: lower(entry.platforms),
    summary: entry.summary.replace(/\s+/g, " ").trim().slice(0, 320),
  };
}

/**
 * Fold new entries into the store. GROWS ONLY: an existing id is refreshed in
 * place (later `observedAt` wins, jurisdiction/class/platform hints union), and
 * an id never present is appended. Nothing is ever removed, so a consolidation
 * that "barely" merges still loses nothing.
 */
export function upsertEntries(
  store: FieldManualStore,
  incoming: readonly FieldManualEntry[],
  now: string,
): FieldManualStore {
  const byId = new Map(store.entries.map((e) => [e.id, e]));
  for (const raw of incoming) {
    const entry = normalizeEntry(raw);
    const prior = byId.get(entry.id);
    if (!prior) {
      byId.set(entry.id, entry);
      continue;
    }
    const priorAt = prior.observedAt ?? "";
    const nextAt = entry.observedAt ?? "";
    const newerWins = nextAt >= priorAt;
    byId.set(entry.id, {
      ...(newerWins ? entry : prior),
      // Union the reach either way: a fact proven in a second jurisdiction now
      // applies to both, never only the latest (RULING 61 — applies retroactively).
      states: lower([...prior.states, ...entry.states]),
      recordClasses: lower([...prior.recordClasses, ...entry.recordClasses]),
      platforms: lower([...prior.platforms, ...entry.platforms]),
      ...((prior.ocdIds || entry.ocdIds) ? { ocdIds: lower([...(prior.ocdIds ?? []), ...(entry.ocdIds ?? [])]) } : {}),
      ...((prior.bodyIds || entry.bodyIds) ? { bodyIds: [...new Set([...(prior.bodyIds ?? []), ...(entry.bodyIds ?? [])])].sort() } : {}),
      observedAt: nextAt >= priorAt ? entry.observedAt : prior.observedAt,
      placeResults: mergePlaceResults(placeResultsOf(prior), placeResultsOf(entry)),
      foundBy: prior.foundBy ?? entry.foundBy,
      ...(entry.kind === "METHOD" && prior.kind === "METHOD" ? { payload: unionMethodReach(prior.payload, entry.payload, newerWins) } : {}),
    });
  }
  for (const profile of jobCostProfiles([...byId.values()], incoming, now)) byId.set(profile.id, profile);
  return { formatVersion: 1, updatedOn: now, entries: [...byId.values()] };
}

function unionMethodReach(prior: unknown, next: unknown, newerWins: boolean): unknown {
  const a = prior as Record<string, unknown>, b = next as Record<string, unknown>;
  const union = (key: string) => [...new Set([...(Array.isArray(a?.[key]) ? a[key] : []), ...(Array.isArray(b?.[key]) ? b[key] : [])])].sort();
  return { ...(newerWins ? b : a), places: union("places"), doorEntryIds: union("doorEntryIds") };
}

const OUTCOME_RANK: Readonly<Record<FieldManualOutcome, number>> = {
  YIELDED: 0,
  REFERENCE: 1,
  ZERO: 2,
  BLOCKED: 3,
  FAILED: 4,
};

export interface FieldManualQuery {
  /** Exact research subject for saved exhausted walks; they are never portable failures. */
  readonly subjectId?: string;
  /** The reading worker's role; SHARED entries always match. Omit to match every role. */
  readonly role?: FieldManualRole;
  /** Lowercase two-letter state; a portable ([]-state) entry always matches. */
  readonly state?: string;
  readonly recordClass?: string;
  readonly platform?: string;
  readonly ocdIds?: readonly string[];
  readonly bodyIds?: readonly string[];
  /** Hard cap on projected lines so a walk's context stays a cache-cheap projection, never the whole store. */
  readonly limit?: number;
  /**
   * The fix map's rows for the place this projection is for (DP-21). Given, each method line says whether it works
   * here or is untried here, and a method that fails here is left out. Omitted, the projection is as it always was.
   */
  readonly fixMapRows?: readonly FixMapRow[];
}

export interface FieldManualProjection {
  /** The projectable lines, most-applicable first. What the worker reads. */
  readonly lines: readonly string[];
  /** The entry ids offered — the "inherited branches" half of the RULING 63 pair. */
  readonly entryIds: readonly string[];
  /** Methods left out because they fail in this place (DP-21); 0 when no fix map rows were given. */
  readonly leftOutFailingHere?: number;
  /** How many entries matched before the limit; total how many the store holds. */
  readonly matched: number;
  readonly total: number;
}

function divisionApplies(scope: string, subject: string): boolean {
  const place = subject.toLowerCase().split("#")[0]!;
  return place === scope || place.startsWith(scope + "/");
}

export function fieldManualPlaceRank(entry: FieldManualEntry, query: FieldManualQuery): number {
  if (query.bodyIds?.some(id => entry.bodyIds?.includes(id))) return 0;
  if (query.ocdIds?.some(id => entry.ocdIds?.some(scope => divisionApplies(scope, id)))) return 1;
  if (query.state && entry.states.includes(query.state.toLowerCase())) return 2;
  return 3;
}

function entryMatches(raw: FieldManualEntry, q: FieldManualQuery): boolean {
  // Old investigation rows also gain their recorded place scope on reads.
  const entry = normalizeEntry(raw);
  if (entry.kind === "JOB_COST") return false;
  if (entry.kind === "EXHAUSTED_RUNGS" && (!q.subjectId || (entry.payload as { subjectId?: string } | null)?.subjectId !== q.subjectId)) return false;
  if (q.role !== undefined && entry.role !== "SHARED" && entry.role !== q.role) return false;
  if (q.state !== undefined && entry.states.length > 0 && !entry.states.includes(q.state.toLowerCase())) return false;
  if (q.recordClass !== undefined && entry.recordClasses.length > 0 && !entry.recordClasses.includes(q.recordClass.toLowerCase())) return false;
  if (q.platform !== undefined && entry.platforms.length > 0 && !entry.platforms.includes(q.platform.toLowerCase())) return false;
  if (q.ocdIds?.length && entry.ocdIds?.length && !q.ocdIds.some(id => entry.ocdIds!.some(scope => divisionApplies(scope, id)))) return false;
  if (q.bodyIds?.length && entry.bodyIds?.length && !q.bodyIds.some(id => entry.bodyIds!.includes(id))) return false;
  return true;
}

/**
 * Project the store down to what applies to this worker and jurisdiction — the
 * "every role gets a projection, not the whole thing" rule. Ordering favours
 * routes that YIELDED, then a jurisdiction-specific entry over a portable one
 * (a state door beats a national hint), then fresher observations, so the most
 * useful few lines survive the limit.
 */
export function projectFieldManual(store: FieldManualStore, query: FieldManualQuery = {}): FieldManualProjection {
  const limit = query.limit ?? 40;
  const matched = store.entries.map(normalizeEntry).filter((e) => entryMatches(e, query));
  const ranked = [...matched].sort((a, b) => {
    const place = query.ocdIds?.length || query.bodyIds?.length ? fieldManualPlaceRank(a, query) - fieldManualPlaceRank(b, query) : 0;
    if (place !== 0) return place;
    const exhausted = Number(b.kind === "EXHAUSTED_RUNGS") - Number(a.kind === "EXHAUSTED_RUNGS");
    if (exhausted !== 0) return exhausted;
    const outcome = OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome];
    if (outcome !== 0) return outcome;
    const aSpecific = query.state !== undefined && a.states.includes(query.state.toLowerCase()) ? 0 : 1;
    const bSpecific = query.state !== undefined && b.states.includes(query.state.toLowerCase()) ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    const freshness = (b.observedAt ?? "").localeCompare(a.observedAt ?? "");
    if (freshness !== 0) return freshness;
    return a.id.localeCompare(b.id);
  });
  const rows = query.fixMapRows;
  const here = new Map(rows === undefined ? [] : ranked.flatMap((e) => { const h = methodHere(e, rows); return h === null ? [] : [[e.id, h] as const]; }));
  const open = rows === undefined ? ranked : ranked.filter((e) => here.get(e.id)?.status !== "FAILS");
  const chosen = open.slice(0, limit);
  return {
    lines: chosen.map((e) => fieldManualLine(e) + (here.has(e.id) ? hereNote(here.get(e.id)!) : "")),
    entryIds: chosen.map((e) => e.id),
    ...(rows === undefined ? {} : { leftOutFailingHere: ranked.length - open.length }),
    matched: matched.length,
    total: store.entries.length,
  };
}

/** The exact one-line rendering a worker sees for one entry. */
export function fieldManualLine(entry: FieldManualEntry): string {
  const where = entry.states.length > 0 ? entry.states.join("/").toUpperCase() : "portable";
  const on = entry.recordClasses.length > 0 ? ` [${entry.recordClasses.join(",")}]` : "";
  const door = entry.url ? ` <${entry.url}>` : "";
  const seen = entry.observedAt ? ` seen ${entry.observedAt.slice(0, 10)}` : "";
  return `${entry.role}/${entry.kind} ${entry.outcome} (${where})${on}: ${entry.title}${door} — ${entry.summary}${seen}`.replace(/\s+/g, " ").trim();
}

/** The repositories the two calls need: just the manual's own aggregate. */
export type FieldManualRepos = Pick<ControlPlaneRepositories, "fieldManual">;

/** The aggregate id the one live manual is stored under. */
export const FIELD_MANUAL_ID = "live";

export interface FieldManualRead {
  /** What applies to the asking role/jurisdiction: the lines to put in front of the worker and the ids offered. */
  readonly projection: FieldManualProjection;
  /** The whole store the projection was cut from, for a caller that narrows it further (a scout's catalog, a used-door check). */
  readonly store: FieldManualStore;
  /** The stored revision this read saw; null when the manual has never been written. */
  readonly revision: number | null;
  /** Set when the store could not be read. The projection is then empty: a failed read is a fact about our store, never a crash in the worker. */
  readonly error?: string;
}

/** Portable entries and this worker's state/role only; the shared parent keeps the full manual. */
export function narrowFieldManual(read: FieldManualRead, query: FieldManualQuery): FieldManualRead {
  const store = { ...read.store, entries: read.store.entries.filter(entry => entryMatches(entry, query)) };
  return { ...read, store, projection: projectFieldManual(store, query) };
}

/** Original entries for this source, across every worker role. A dead route
 * remains knowledge, not a permanent ban on its host or other routes. */
export function fieldManualForSource(read: FieldManualRead, url: string, state?: string): readonly FieldManualEntry[] {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return []; }
  const projection = projectFieldManual(read.store, { state, limit: read.store.entries.length });
  const entries = new Map(read.store.entries.map(entry => [entry.id, entry]));
  return projection.entryIds.flatMap(id => {
    const entry = entries.get(id)!;
    try { return entry.url && new URL(entry.url).origin === origin ? [entry] : []; }
    catch { return []; }
  });
}

/**
 * **THE ONE READ.** Every role reads the manual through this call: the current
 * stored manual, cut down to `query` (role, state, record class, platform). A
 * read failure comes back as `error` with an empty projection so the worker
 * walks without inherited knowledge rather than failing.
 */
export async function readFieldManual(repos: FieldManualRepos, query: FieldManualQuery = {}): Promise<FieldManualRead> {
  try {
    if (process.env.WTP_WORKER_TOOLS_URL) {
      const response = await fetch(process.env.WTP_WORKER_TOOLS_URL, { method: "POST",
        headers: { "content-type": "application/json", authorization: process.env.WTP_WORKER_TOOLS_TOKEN ?? "" },
        body: JSON.stringify({ kind: "manual", body: query }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`SHARED_MANUAL_FAILED:${response.status}`);
      return await response.json() as FieldManualRead;
    }
    const row = await repos.fieldManual.read(FIELD_MANUAL_ID);
    const store = row?.value ?? emptyFieldManual();
    return { projection: projectFieldManual(store, query), store, revision: row?.revision ?? null };
  } catch (error) {
    const store = emptyFieldManual();
    return {
      projection: projectFieldManual(store, query),
      store,
      revision: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Build one entry from the few fields a role actually has; everything else takes the neutral default. */
export function newFieldManualEntry(
  source: string,
  key: string,
  fields: Pick<FieldManualEntry, "role" | "kind" | "title" | "summary" | "outcome"> & Partial<FieldManualEntry>,
): FieldManualEntry {
  return {
    states: [],
    recordClasses: [],
    platforms: [],
    url: null,
    observedAt: null,
    tier: null,
    payload: {},
    ...fields,
    id: fieldManualEntryId(source, key),
    source,
  };
}

/**
 * **THE ONE WRITE.** Fold what a role just learned into the live manual, grow-only,
 * using the store's own compare-and-set to survive a concurrent writer. A write
 * failure is returned, never thrown: it must not lose the result that was
 * already learned.
 */
export async function writeFieldManual(
  repos: FieldManualRepos,
  entries: readonly FieldManualEntry[],
  now: string,
): Promise<{ readonly written: number; readonly error?: string }> {
  if (entries.length === 0) return { written: 0 };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const current = await repos.fieldManual.read(FIELD_MANUAL_ID);
      const next = upsertEntries(current?.value ?? emptyFieldManual(), entries, now);
      if (current === null) await repos.fieldManual.put(FIELD_MANUAL_ID, next, now);
      else await repos.fieldManual.compareAndSet(FIELD_MANUAL_ID, current.revision, next, now);
      await flushBankWriteFailures(repos, now);
      return { written: entries.length };
    } catch (error) {
      if (attempt === 3) {
        await recordBankWriteFailure(repos, now);
        return { written: 0, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  return { written: 0 };
}
