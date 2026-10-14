import { createHash } from "node:crypto";

import { stateOfPlace, type FixMapRow, type MethodWorks } from "../method/fix-map.ts";
import { recordAttempts, type MethodAttempt } from "../method/fix-map-record.ts";
import { methodPlaceOf } from "../method/method-places.ts";
import { sortRung } from "./field-manual-rungs.ts";
import { hereNote, mergePlaceResults, placeResultsOf, type MethodHere, type PlaceResult } from "./field-manual-places.ts";
import { recordAttemptsKeepingHistory } from "./fix-history.ts";
import { ConcurrentModification, IdentityCollision, type ControlPlaneRepositories, type Persisted } from "./repository/types.ts";
import { flushBankWriteFailures, recordBankWriteFailure } from "./bank-write-health.ts";
import { jobCostProfiles } from "./bank-job-cost.ts";

/** Every worker role whose learnings the manual carries. SHARED = every role reads it. */
export const FIELD_MANUAL_ROLES = [
  "HUNTER",
  "SCOUT",
  "ACQUIRER",
  "PARSER",
  "DETECTIVE",
  "VALIDATOR",
  "AUDITOR",
  "ENGINEER",
  "MEASURE_WRITER",
  "MEASURE_CHECKER",
  "ASK_READER",
  "ASK_WRITER",
  "ASK_FALLBACK",
  "SHARED",
] as const;
export type FieldManualRole = (typeof FIELD_MANUAL_ROLES)[number];

export type FieldManualOutcome = "YIELDED" | "ZERO" | "FAILED" | "BLOCKED" | "REFERENCE";

/** Where an entry applies. Each part only grows. */
export interface FieldManualReach {
  /** `ocd-division/...` scopes (they cover their descendants) and `body:<id>`. */
  readonly places: readonly string[];
  /** Lowercase two-letter states it applies across. */
  readonly states: readonly string[];
  /** Platforms it applies on, in any state. */
  readonly platforms: readonly string[];
  /** Applies to every job of its role and record class. */
  readonly everywhere: boolean;
  /** A method offered anywhere it fits, ranked by where it has worked. */
  readonly method?: boolean;
}

export interface FieldManualEntry {
  /** Deterministic from (source, key): a re-import updates rather than duplicates. */
  readonly id: string;
  readonly role: FieldManualRole;
  /** ROUTE | METHOD | PLATFORM_FINGERPRINT | BODY_RUNG | VENDOR_TENANT | SOURCE_REGISTER | PLAYBOOK | SCOUT_DISCOVERY | ... */
  readonly kind: string;
  readonly title: string;
  /** ONE short line a worker reads. No newlines. */
  readonly summary: string;
  /** Lowercase two-letter states it was learned in. */
  readonly states: readonly string[];
  /** Record classes / fields this bears on (e.g. "meetings", "campaignSite"). Empty = any. */
  readonly recordClasses: readonly string[];
  /** Vendor platforms this is about (e.g. "legistar", "civicplus"). */
  readonly platforms: readonly string[];
  /** Place scope. Division prefixes apply to their descendants; body IDs are exact. */
  readonly ocdIds?: readonly string[];
  readonly bodyIds?: readonly string[];
  /** The writer's word that this applies to every job of its role and record class, wherever it is. */
  readonly portable?: boolean;
  /** Where it applies; set when the entry is saved. */
  readonly reach?: FieldManualReach;
  readonly foundBy?: "SCOUT" | "DETECTIVE";
  /** The latest result anywhere, for display. What happened in each place is `placeResults`. */
  readonly outcome: FieldManualOutcome;
  /** One result per place, so a result in one place never overwrites another's. */
  readonly placeResults?: readonly PlaceResult[];
  /** The door itself, when the entry is one. */
  readonly url: string | null;
  /** Which original store this came from (path or table name). Provenance, never dropped. */
  readonly source: string;
  /** UTC YYYY-MM-DD or ISO, when known. Freshness only; never scheduling authority. */
  readonly observedAt: string | null;
  /** A0/A1/B/C tier where the source states one. */
  readonly tier: string | null;
  /** THE ORIGINAL RECORD, VERBATIM. */
  readonly payload: unknown;
}

/** The rows one read returned. */
export interface FieldManualStore {
  readonly entries: readonly FieldManualEntry[];
}

export function emptyFieldManual(): FieldManualStore {
  return { entries: [] };
}

/** A stable id, derived so a re-import of the same fact updates one row instead of forking it. */
export function fieldManualEntryId(source: string, key: string): string {
  return `fm-${createHash("sha256").update(`${source}|::|${key}`).digest("hex").slice(0, 24)}`;
}

function lower(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v !== ""))].sort();
}

/** A measured attempt cost: bookkeeping that feeds the platform cost profiles. */
export const JOB_COST_KIND = "JOB_COST";

/** Kinds that hold bookkeeping rather than lessons; no worker is shown them. */
const BOOKKEEPING_KINDS: ReadonlySet<string> = new Set([JOB_COST_KIND, "WRITE_HEALTH", "COPY_REPORT", "PLAYBOOK_RETIREMENT", "PLATFORM_CENSUS_CHECK", "PLATFORM_CENSUS_REFERENCE", "PLATFORM_CENSUS_RUN"]);

/** Reusable ways in: a method from one place is offered wherever it could apply, ranked by where it has worked. */
export const TRANSFERABLE_METHOD_KINDS: ReadonlySet<string> = new Set(["METHOD", "ROUTE", "MANIFEST_BRANCH"]);

/** A method that is not tied to one source: a procedure (no door of its own), one shaped by a platform, or a step offered anywhere it fits. */
export function isTransferableMethod(entry: Pick<FieldManualEntry, "kind" | "url" | "platforms" | "reach">): boolean {
  return (TRANSFERABLE_METHOD_KINDS.has(entry.kind) && (entry.url === null || entry.platforms.length > 0)) || entry.reach?.method === true;
}

const OCD = /ocd-division\/[^\s"'<>#,;)]+/i;

/** The place a record names, read from the fields writers use for it. */
export function fieldManualPlaceHints(payload: unknown): { states: string[]; ocdIds: string[]; bodyIds: string[] } {
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const outcomes = Array.isArray(p.outcomes) ? p.outcomes : [];
  const proposal = p.proposal && typeof p.proposal === "object" ? p.proposal as Record<string, unknown> : null;
  const proposed = proposal?.outcome && typeof proposal.outcome === "object" ? (proposal.outcome as Record<string, unknown>).jurisdiction : null;
  const where = typeof p.where === "string" ? OCD.exec(p.where)?.[0] ?? null : null;
  const subjects = [p.subjectId, p.jurisdiction, p.divisionId, p.ocdId, p.bodyId, proposed, where,
    ...outcomes.map(value => value && typeof value === "object" ? (value as Record<string, unknown>).jurisdiction : null)]
    .filter((value): value is string => typeof value === "string");
  const ocdIds = lower(subjects.filter(value => value.toLowerCase().startsWith("ocd-division/")).map(value => value.split("#")[0]!));
  const states = lower(subjects.flatMap(value => {
    const state = /(?:state:|^)([a-z]{2})(?:\b|:)/i.exec(value)?.[1];
    return state ? [state] : [];
  }));
  const bodyIds = [...new Set([p.bodyId, ...(Array.isArray(p.bodyIds) ? p.bodyIds : [])].filter((value): value is string => typeof value === "string"))];
  return { states, ocdIds, bodyIds };
}

export function reachOf(entry: Pick<FieldManualEntry, "ocdIds" | "bodyIds" | "states" | "platforms" | "url" | "portable">): FieldManualReach {
  const places = [...(entry.ocdIds ?? []), ...(entry.bodyIds ?? []).map((id) => `body:${id}`)];
  const everywhere = entry.portable === true;
  if (places.length > 0) return { places: [...new Set(places)].sort(), states: [], platforms: entry.url === null ? [...entry.platforms] : [], everywhere };
  if (entry.platforms.length > 0) return { places: [], states: [], platforms: [...entry.platforms], everywhere };
  return { places: [], states: [...entry.states], platforms: [], everywhere };
}

function unionReach(a: FieldManualReach | undefined, b: FieldManualReach): FieldManualReach {
  if (a === undefined) return b;
  return {
    places: [...new Set([...a.places, ...b.places])].sort(),
    states: lower([...a.states, ...b.states]),
    platforms: lower([...a.platforms, ...b.platforms]),
    everywhere: a.everywhere || b.everywhere,
    ...(a.method || b.method ? { method: true } : {}),
  };
}

/** Normalise one observation: hints read from its record, arrays order-insensitive, and its reach. */
export function normalizeEntry(entry: FieldManualEntry): FieldManualEntry {
  const place = fieldManualPlaceHints(entry.payload);
  const ocdIds = lower([...(entry.ocdIds ?? []), ...place.ocdIds]);
  const bodyIds = [...new Set([...(entry.bodyIds ?? []), ...place.bodyIds])].sort();
  const normalized: FieldManualEntry = {
    ...entry,
    states: lower([...entry.states, ...place.states]),
    ...(ocdIds.length ? { ocdIds } : {}),
    ...(bodyIds.length ? { bodyIds } : {}),
    recordClasses: lower(entry.recordClasses),
    platforms: lower(entry.platforms),
    summary: entry.summary.replace(/\s+/g, " ").trim().slice(0, 320),
  };
  const sorted = sortRung(normalized)?.entry ?? normalized;
  return { ...sorted, reach: unionReach(sorted.reach, reachOf(sorted)) };
}

export function mergeEntry(prior: FieldManualEntry | null, raw: FieldManualEntry): FieldManualEntry {
  const entry = normalizeEntry(raw);
  if (prior === null) return entry;
  const priorAt = prior.observedAt ?? "";
  const nextAt = entry.observedAt ?? "";
  const newerWins = nextAt >= priorAt;
  const ocdIds = lower([...(prior.ocdIds ?? []), ...(entry.ocdIds ?? [])]);
  const bodyIds = [...new Set([...(prior.bodyIds ?? []), ...(entry.bodyIds ?? [])])].sort();
  const anyClass = prior.recordClasses.length === 0 || entry.recordClasses.length === 0;
  return {
    ...(newerWins ? entry : prior),
    states: lower([...prior.states, ...entry.states]),
    recordClasses: anyClass ? [] : lower([...prior.recordClasses, ...entry.recordClasses]),
    platforms: lower([...prior.platforms, ...entry.platforms]),
    ...(ocdIds.length ? { ocdIds } : {}),
    ...(bodyIds.length ? { bodyIds } : {}),
    ...(prior.portable || entry.portable ? { portable: true } : {}),
    reach: unionReach(unionReach(prior.reach, reachOf(prior)), entry.reach!),
    observedAt: newerWins ? entry.observedAt : prior.observedAt,
    placeResults: mergePlaceResults(placeResultsOf(prior), placeResultsOf(entry)),
    foundBy: prior.foundBy ?? entry.foundBy,
    payload: mergePayload(prior, entry, newerWins),
  };
}

function mergePayload(prior: FieldManualEntry, next: FieldManualEntry, newerWins: boolean): unknown {
  const a = prior.payload as Record<string, unknown> | null, b = next.payload as Record<string, unknown> | null;
  const union = (key: string) => [...new Set([...(Array.isArray(a?.[key]) ? a[key] as unknown[] : []), ...(Array.isArray(b?.[key]) ? b[key] as unknown[] : [])])].sort();
  const kept = newerWins ? b : a;
  if (prior.kind === "METHOD" && next.kind === "METHOD") return { ...kept, places: union("places"), doorEntryIds: union("doorEntryIds") };
  if (prior.kind === "PARSE_FIELDS" && next.kind === "PARSE_FIELDS") return { ...kept, fieldNames: union("fieldNames") };
  return kept;
}

/** Fold many observations by id, in order. Pure. */
export function foldEntries(entries: readonly FieldManualEntry[]): FieldManualEntry[] {
  const byId = new Map<string, FieldManualEntry>();
  for (const entry of entries) byId.set(entry.id, mergeEntry(byId.get(entry.id) ?? null, entry));
  return [...byId.values()];
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
  /** Lowercase two-letter state of the job. */
  readonly state?: string;
  readonly recordClass?: string;
  /** The job's platform, when known; platform lessons for other platforms are left out. */
  readonly platform?: string;
  /** The job's place: its division and bodies. */
  readonly ocdIds?: readonly string[];
  readonly bodyIds?: readonly string[];
  /** Only these kinds. */
  readonly kinds?: readonly string[];
  /** Every row of the role, class and kinds asked, wherever it applies: for passes that cover the whole country. */
  readonly everywhere?: boolean;
  /** Hard cap on projected lines, so a walk's context stays a page, never the whole manual. */
  readonly limit?: number;
}

/** What the fix map holds for the methods in one read. */
export interface MethodEvidence {
  /** The fix map's rows for the job's place. */
  readonly here: readonly FixMapRow[];
  /** Where each method works. */
  readonly works: Readonly<Record<string, MethodWorks>>;
}

export interface FieldManualProjection {
  /** The projectable lines, most-applicable first. What the worker reads. */
  readonly lines: readonly string[];
  /** The entry ids offered: the inherited half of the inherited-versus-newly-built pair. */
  readonly entryIds: readonly string[];
  /** Each offered entry's rank: 1 this place, 2 its state (or its platform), 3 national, 4 worked elsewhere, 5 not yet worked anywhere. */
  readonly tiers: readonly number[];
  /** Methods left out because they fail in this place. */
  readonly leftOutFailingHere: number;
  /** How many entries applied before the limit; total how many the read returned. */
  readonly matched: number;
  readonly total: number;
}

function divisionApplies(scope: string, subject: string): boolean {
  const place = subject.toLowerCase().split("#")[0]!;
  return place === scope || place.startsWith(scope + "/");
}

/** The job's own places: its divisions and `body:<id>`s. */
function jobPlaces(query: FieldManualQuery): string[] {
  return [...(query.ocdIds ?? []).map((id) => id.toLowerCase().split("#")[0]!), ...(query.bodyIds ?? []).map((id) => `body:${id}`)];
}

/** Every division scope that covers the job's divisions (the divisions themselves and their ancestors). */
export function coveringPlaces(query: Pick<FieldManualQuery, "ocdIds" | "bodyIds">): string[] {
  const out = new Set<string>();
  for (const id of query.ocdIds ?? []) {
    const parts = id.toLowerCase().split("#")[0]!.split("/");
    for (let n = 2; n <= parts.length; n += 1) out.add(parts.slice(0, n).join("/"));
  }
  for (const id of query.bodyIds ?? []) out.add(`body:${id}`);
  return [...out].sort();
}

function placeMatches(places: readonly string[], query: FieldManualQuery): boolean {
  const job = jobPlaces(query);
  return places.some((scope) => job.some((place) => scope.startsWith("body:") ? scope === place : divisionApplies(scope, place)));
}

/** The job's state: asked, or read from its division. */
export function queryState(query: Pick<FieldManualQuery, "state" | "ocdIds">): string | undefined {
  return query.state?.toLowerCase() ?? (query.ocdIds ?? []).map(stateOfPlace).find((s): s is string => s !== null);
}

function reachOfStored(entry: FieldManualEntry): FieldManualReach {
  return entry.reach ?? reachOf(entry);
}

/** Whether a stored row is one the job could use: the read's exact rule (the stores may return more). */
export function entryInSlice(entry: FieldManualEntry, query: FieldManualQuery): boolean {
  if (query.role !== undefined && entry.role !== "SHARED" && entry.role !== query.role) return false;
  if (query.kinds !== undefined && !query.kinds.includes(entry.kind)) return false;
  if (query.recordClass !== undefined && entry.recordClasses.length > 0 && !entry.recordClasses.includes(query.recordClass.toLowerCase())) return false;
  // A job on a known platform takes platform lessons and methods for that platform only.
  const platform = query.platform?.toLowerCase();
  const onPlatform = (platforms: readonly string[]) => platform === undefined || platforms.length === 0 || platforms.includes(platform);
  if (query.everywhere === true) return onPlatform(entry.platforms);
  const reach = reachOfStored(entry);
  if (reach.everywhere || placeMatches(reach.places, query)) return true;
  if (reach.platforms.length > 0 && onPlatform(reach.platforms)) return true;
  if (isTransferableMethod(entry) && onPlatform(entry.platforms)) return true;
  const state = queryState(query);
  return state !== undefined && reach.states.includes(state);
}

/** A place in plain words: "pima AZ". */
export const placeLabel = (place: string): string => {
  const parts = place.split("/");
  const last = parts.at(-1) ?? place;
  const state = stateOfPlace(place);
  return state !== null && last !== `state:${state}` ? `${last.replace(/^[a-z_]+:/, "").replace(/_/g, " ")} ${state.toUpperCase()}` : state?.toUpperCase() ?? place;
};

interface Ranked {
  readonly entry: FieldManualEntry;
  readonly tier: number;
  readonly note: string;
}

function legacyHere(entry: FieldManualEntry, query: FieldManualQuery): "WORKS" | "FAILS" | null {
  const here = placeResultsOf(entry).filter((r) => r.place !== "any" && !r.place.startsWith("state:") && placeMatches([r.place], query));
  if (here.some((r) => r.outcome === "FAILED" || r.outcome === "BLOCKED")) return "FAILS";
  return here.some((r) => r.outcome === "YIELDED") ? "WORKS" : null;
}

function legacyWorks(entry: FieldManualEntry): { places: string[]; states: string[] } {
  const yielded = placeResultsOf(entry).filter((r) => r.outcome === "YIELDED" && r.place !== "any");
  return {
    places: yielded.filter((r) => !r.place.startsWith("state:")).map((r) => r.place),
    states: yielded.flatMap((r) => r.place.startsWith("state:") ? [r.place.slice(6)] : stateOfPlace(r.place) ?? []),
  };
}

function methodRank(entry: FieldManualEntry, query: FieldManualQuery, evidence: MethodEvidence | undefined): Ranked | null {
  const row = evidence?.here.find((r) => r.methodId === entry.id);
  const fixed = row === undefined || row.state === "UNTRIED" ? null : row.state;
  const here = fixed ?? legacyHere(entry, query);
  if (here === "FAILS") return null;
  if (here === "WORKS") return { entry, tier: 1, note: hereNote({ status: "WORKS" }) };
  const untried: MethodHere = { status: "UNTRIED" };
  if (placeMatches(reachOfStored(entry).places, query)) return { entry, tier: 1, note: hereNote(untried) };
  const held = evidence?.works[entry.id];
  const legacy = legacyWorks(entry);
  const states = lower([...(held?.states ?? []), ...legacy.states]);
  const places = [...new Set([...(held?.places ?? []), ...legacy.places])];
  const state = queryState(query);
  const where = places.length > 0 ? places.slice(0, 3).map(placeLabel).join(", ") : states.map((s) => s.toUpperCase()).join(", ");
  const worked = (prefix: string) => hereNote(untried).replace(/\]$/, `; ${prefix}]`);
  if (state !== undefined && states.includes(state)) return { entry, tier: 2, note: worked(`worked in ${where}`) };
  if (states.length >= 3) return { entry, tier: 3, note: worked(`worked in ${states.length} states: ${states.map((s) => s.toUpperCase()).join(", ")}`) };
  if (states.length > 0 || places.length > 0) return { entry, tier: 4, note: worked(`worked in ${where}`) };
  return { entry, tier: 5, note: hereNote(untried) };
}

/** An entry's rank for the job, with the words a worker reads after its line; null when it is left out here. */
export function rankEntry(entry: FieldManualEntry, query: FieldManualQuery, evidence?: MethodEvidence): Ranked | null {
  if (isTransferableMethod(entry)) return methodRank(entry, query, evidence);
  const reach = reachOfStored(entry);
  if (placeMatches(reach.places, query)) return { entry, tier: 1, note: "" };
  const state = queryState(query);
  const platform = query.platform?.toLowerCase();
  if ((state !== undefined && reach.states.includes(state)) || (platform !== undefined && reach.platforms.includes(platform))) return { entry, tier: 2, note: "" };
  return { entry, tier: 3, note: "" };
}

export function projectFieldManual(store: FieldManualStore, query: FieldManualQuery = {}, evidence?: MethodEvidence): FieldManualProjection {
  const limit = query.limit ?? 40;
  const applicable = store.entries.filter((e) => !BOOKKEEPING_KINDS.has(e.kind) && entryInSlice(e, query) &&
    (e.kind !== "EXHAUSTED_RUNGS" || (query.subjectId !== undefined && (e.payload as { subjectId?: string } | null)?.subjectId === query.subjectId)));
  const ranked = applicable.map((e) => rankEntry(e, query, evidence));
  const open = ranked.filter((r): r is Ranked => r !== null).sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const exhausted = Number(b.entry.kind === "EXHAUSTED_RUNGS") - Number(a.entry.kind === "EXHAUSTED_RUNGS");
    if (exhausted !== 0) return exhausted;
    const outcome = OUTCOME_RANK[a.entry.outcome] - OUTCOME_RANK[b.entry.outcome];
    if (outcome !== 0) return outcome;
    const freshness = (b.entry.observedAt ?? "").localeCompare(a.entry.observedAt ?? "");
    if (freshness !== 0) return freshness;
    return a.entry.id.localeCompare(b.entry.id);
  });
  const chosen = open.slice(0, limit);
  return {
    lines: chosen.map((r) => fieldManualLine(r.entry) + r.note),
    entryIds: chosen.map((r) => r.entry.id),
    tiers: chosen.map((r) => r.tier),
    leftOutFailingHere: ranked.length - open.length,
    matched: open.length,
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

/** The repositories the two calls need: the manual's rows, and the fix map and fix list where the store has them. */
export type FieldManualRepos = Pick<ControlPlaneRepositories, "fieldManual"> & Partial<Pick<ControlPlaneRepositories, "fixMap" | "adminConfig">>;

export interface FieldManualRead {
  /** What applies to the asking job: the lines to put in front of the worker and the ids offered. */
  readonly projection: FieldManualProjection;
  /** The rows the read returned, for a caller that narrows them further (a scout's catalog, a used-door check). */
  readonly store: FieldManualStore;
  /** What the fix map held for the methods read, so a caller re-ranking the rows ranks them the same way. */
  readonly evidence?: MethodEvidence;
  /** Set when the manual could not be read. The projection is then empty: a failed read is a fact about our store, never a crash in the worker. */
  readonly error?: string;
}

/** Original entries for this source, across every worker role. A dead route
 * remains knowledge, not a permanent ban on its host or other routes. */
export function fieldManualForSource(read: FieldManualRead, url: string): readonly FieldManualEntry[] {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return []; }
  return read.store.entries.filter(entry => {
    try { return entry.url !== null && new URL(entry.url).origin === origin; }
    catch { return false; }
  });
}

/** What the fix map says of the methods a read returned, for the job's place. */
export async function readMethodEvidence(repos: FieldManualRepos, entries: readonly FieldManualEntry[], query: FieldManualQuery): Promise<MethodEvidence | undefined> {
  if (!repos.fixMap) return undefined;
  const methods = entries.filter(isTransferableMethod).map((e) => e.id);
  const places = jobPlaces(query).filter((p) => !p.startsWith("body:"));
  const [here, works] = await Promise.all([
    Promise.all(places.map((p) => repos.fixMap!.forPlace(p, 1000))).then((rows) => rows.flat()),
    methods.length === 0 ? new Map<string, MethodWorks>() : repos.fixMap.worksFor(methods),
  ]);
  return { here, works: Object.fromEntries(works) };
}

/** The read against the store itself. */
export async function readFieldManualRows(repos: FieldManualRepos, query: FieldManualQuery = {}): Promise<FieldManualRead> {
  try {
    const rows = (await repos.fieldManual.slice(query)).map((row) => row.value).filter((entry) => entryInSlice(entry, query));
    const store = { entries: rows };
    const evidence = await readMethodEvidence(repos, rows, query);
    return { projection: projectFieldManual(store, query, evidence), store, ...(evidence ? { evidence } : {}) };
  } catch (error) {
    const store = emptyFieldManual();
    return { projection: projectFieldManual(store, query), store, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readFieldManualForPlaces(
  repos: FieldManualRepos,
  covering: FieldManualQuery,
  queries: readonly FieldManualQuery[],
): Promise<FieldManualRead[]> {
  const failed = (query: FieldManualQuery, error: unknown): FieldManualRead => {
    const store = emptyFieldManual();
    return { projection: projectFieldManual(store, query), store, error: error instanceof Error ? error.message : String(error) };
  };
  let rows: readonly FieldManualEntry[];
  try {
    rows = (await repos.fieldManual.slice(covering)).map((row) => row.value).filter((entry) => entryInSlice(entry, covering));
  } catch (error) {
    return queries.map((query) => failed(query, error));
  }
  return Promise.all(queries.map(async (query): Promise<FieldManualRead> => {
    try {
      const store = { entries: rows.filter((entry) => entryInSlice(entry, query)) };
      const evidence = await readMethodEvidence(repos, store.entries, query);
      return { projection: projectFieldManual(store, query, evidence), store, ...(evidence ? { evidence } : {}) };
    } catch (error) {
      return failed(query, error);
    }
  }));
}

export async function readFieldManual(repos: FieldManualRepos, query: FieldManualQuery = {}): Promise<FieldManualRead> {
  if (!process.env.WTP_WORKER_TOOLS_URL) return readFieldManualRows(repos, query);
  try {
    const response = await fetch(process.env.WTP_WORKER_TOOLS_URL, { method: "POST",
      headers: { "content-type": "application/json", authorization: process.env.WTP_WORKER_TOOLS_TOKEN ?? "" },
      body: JSON.stringify({ kind: "manual", body: query }), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`SHARED_MANUAL_FAILED:${response.status}`);
    return await response.json() as FieldManualRead;
  } catch (error) {
    const store = emptyFieldManual();
    return { projection: projectFieldManual(store, query), store, error: error instanceof Error ? error.message : String(error) };
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

/** Each lost race lets another writer through, so this many attempts outlast that many writers on one row. */
const MERGE_ATTEMPTS = 32;

/** Save one entry: merged into its row under the row's own compare-and-set; a lost race re-reads that row only. */
async function saveEntry(repos: FieldManualRepos, entry: FieldManualEntry, held: Persisted<FieldManualEntry> | null, now: string): Promise<void> {
  let current = held;
  for (let attempt = 0; ; attempt += 1) {
    const next = mergeEntry(current?.value ?? null, entry);
    if (current !== null && JSON.stringify(next) === JSON.stringify(current.value)) return;
    try {
      if (current === null) await repos.fieldManual.put(entry.id, next, now);
      else await repos.fieldManual.compareAndSet(entry.id, current.revision, next, now);
      return;
    } catch (error) {
      if (attempt + 1 >= MERGE_ATTEMPTS || !(error instanceof ConcurrentModification || error instanceof IdentityCollision)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(attempt, 8) * 5));
      current = await repos.fieldManual.read(entry.id);
    }
  }
}

/** Save entries row by row; returns how many saved and the first failure. */
export async function saveFieldManualEntries(repos: FieldManualRepos, entries: readonly FieldManualEntry[], now: string): Promise<{ written: number; error?: string }> {
  const folded = foldEntries(entries);
  const held = new Map((await repos.fieldManual.readMany(folded.map((e) => e.id))).map((row) => [row.id, row] as const));
  let written = 0;
  let error: string | undefined;
  for (const entry of folded) {
    try {
      await saveEntry(repos, entry, held.get(entry.id) ?? null, now);
      written += 1;
    } catch (failure) {
      error ??= failure instanceof Error ? failure.message : String(failure);
    }
  }
  return error === undefined ? { written } : { written, error };
}

const TRIED: Readonly<Record<FieldManualOutcome, MethodAttempt["outcome"]>> = {
  YIELDED: "SUCCEEDED", FAILED: "FAILED", BLOCKED: "FAILED", ZERO: "FAILED", REFERENCE: "INCONCLUSIVE",
};

/** The fix-map results a saved method carries: one per place it records a result for. */
export function methodAttemptsOf(entry: FieldManualEntry, now: string): MethodAttempt[] {
  if (!isTransferableMethod(entry)) return [];
  const p = entry.payload as { places?: unknown; outcomes?: unknown } | null;
  const at = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : now;
  const results: { place: string; outcome: FieldManualOutcome; at: string }[] = [];
  if (Array.isArray(p?.outcomes)) {
    for (const o of p.outcomes as { jurisdiction?: unknown; outcome?: unknown; observedOn?: unknown; walkedOn?: unknown }[]) {
      const place = typeof o?.jurisdiction === "string" ? methodPlaceOf(o.jurisdiction) : null;
      if (place !== null && typeof o.outcome === "string" && o.outcome in TRIED) {
        const when = [o.observedOn, o.walkedOn].find((v): v is string => typeof v === "string") ?? entry.observedAt;
        results.push({ place, outcome: o.outcome as FieldManualOutcome, at: at(when) });
      }
    }
  }
  const named = Array.isArray(p?.places) ? (p.places as unknown[]).flatMap((v) => typeof v === "string" ? methodPlaceOf(v) ?? [] : []) : [];
  for (const place of [...named, ...(entry.ocdIds ?? [])]) {
    if (!results.some((r) => r.place === place)) results.push({ place, outcome: entry.outcome, at: at(entry.observedAt) });
  }
  return results.map((r) => ({
    kind: entry.foundBy ?? "ROUTE_RUN",
    attemptId: `manual:${entry.id}:${r.place}:${r.at}`,
    placeId: r.place,
    methodIds: [entry.id],
    outcome: TRIED[r.outcome],
    cause: TRIED[r.outcome] === "FAILED" ? `${entry.title}: ${entry.outcome.toLowerCase()} here` : null,
    at: r.at,
  }));
}

export async function recordMethodResults(repos: FieldManualRepos, entries: readonly FieldManualEntry[], now: string,
  keepHistory = true): Promise<{ readonly written: number; readonly failed: number }> {
  if (!repos.fixMap) return { written: 0, failed: 0 };
  const attempts = entries.flatMap((e) => methodAttemptsOf(normalizeEntry(e), now));
  if (attempts.length === 0) return { written: 0, failed: 0 };
  const titles = new Map(entries.map((e) => [e.id, e.title] as const));
  try {
    const done = keepHistory && repos.adminConfig
      ? await recordAttemptsKeepingHistory(repos.fixMap, { adminConfig: repos.adminConfig }, attempts, (id) => titles.get(id) ?? null)
      : await recordAttempts(repos.fixMap, attempts);
    return { written: done.written, failed: done.failed };
  } catch {
    return { written: 0, failed: attempts.length };
  }
}

export async function writeFieldManual(
  repos: FieldManualRepos,
  entries: readonly FieldManualEntry[],
  now: string,
): Promise<{ readonly written: number; readonly error?: string }> {
  if (entries.length === 0) return { written: 0 };
  try {
    const saved = await saveFieldManualEntries(repos, entries, now);
    const costs = entries.filter((e) => e.kind === JOB_COST_KIND);
    if (costs.length > 0 && saved.error === undefined) {
      const keys = new Map(costs.map((e) => {
        const p = e.payload as { platform: string; recordClass: string };
        return [`${p.platform}|${p.recordClass}`, p] as const;
      }));
      const held = (await Promise.all([...keys.values()].map((p) =>
        repos.fieldManual.slice({ kinds: [JOB_COST_KIND], platform: p.platform, recordClass: p.recordClass, everywhere: true }))))
        .flat().map((row) => row.value);
      const profiles = jobCostProfiles(foldEntries([...held, ...costs]), costs, now);
      const profiled = await saveFieldManualEntries(repos, profiles, now);
      if (profiled.error !== undefined) throw new Error(profiled.error);
    }
    await recordMethodResults(repos, entries, now);
    if (saved.error !== undefined) {
      await recordBankWriteFailure(repos, now);
      return { written: saved.written, error: saved.error };
    }
    await flushBankWriteFailures(repos, now);
    return { written: saved.written };
  } catch (error) {
    await recordBankWriteFailure(repos, now).catch(() => undefined);
    return { written: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
