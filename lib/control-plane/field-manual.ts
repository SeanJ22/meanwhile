import { createHash } from "node:crypto";

import { stateOfPlace, type FixMapRow, type MethodWorks } from "../method/fix-map.ts";
import { recordAttempts, type MethodAttempt } from "../method/fix-map-record.ts";
import { methodPlaceOf } from "../method/method-places.ts";
import { hereNote, mergePlaceResults, placeResultsOf, type MethodHere, type PlaceResult } from "./field-manual-places.ts";
import { recordAttemptsKeepingHistory } from "./fix-history.ts";
import { ConcurrentModification, IdentityCollision, type ControlPlaneRepositories, type Persisted } from "./repository/types.ts";
import { flushBankWriteFailures, recordBankWriteFailure } from "./bank-write-health.ts";

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

export interface FieldManualReach {

  readonly places: readonly string[];

  readonly states: readonly string[];

  readonly platforms: readonly string[];

  readonly everywhere: boolean;

  readonly method?: boolean;
}

export interface FieldManualEntry {

  readonly id: string;
  readonly role: FieldManualRole;

  readonly kind: string;
  readonly title: string;

  readonly summary: string;

  readonly states: readonly string[];

  readonly recordClasses: readonly string[];

  readonly platforms: readonly string[];

  readonly ocdIds?: readonly string[];
  readonly bodyIds?: readonly string[];

  readonly portable?: boolean;

  readonly reach?: FieldManualReach;
  readonly foundBy?: "SCOUT" | "DETECTIVE";

  readonly outcome: FieldManualOutcome;

  readonly placeResults?: readonly PlaceResult[];

  readonly url: string | null;

  readonly source: string;

  readonly observedAt: string | null;

  readonly tier: string | null;

  readonly payload: unknown;
}

export interface FieldManualStore {
  readonly entries: readonly FieldManualEntry[];
}

export function emptyFieldManual(): FieldManualStore {
  return { entries: [] };
}

export function fieldManualEntryId(source: string, key: string): string {
  return `fm-${createHash("sha256").update(`${source}|::|${key}`).digest("hex").slice(0, 24)}`;
}

function lower(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v !== ""))].sort();
}

export const BOOKKEEPING_KINDS: ReadonlySet<string> = new Set(["JOB_COST", "WRITE_HEALTH", "COPY_REPORT", "PLAYBOOK_RETIREMENT", "PLATFORM_CENSUS_CHECK", "PLATFORM_CENSUS_REFERENCE", "PLATFORM_CENSUS_RUN"]);

export const TRANSFERABLE_METHOD_KINDS: ReadonlySet<string> = new Set(["METHOD", "ROUTE", "MANIFEST_BRANCH"]);

export function isTransferableMethod(entry: Pick<FieldManualEntry, "kind" | "url" | "platforms" | "reach">): boolean {
  return (TRANSFERABLE_METHOD_KINDS.has(entry.kind) && (entry.url === null || entry.platforms.length > 0)) || entry.reach?.method === true;
}

const OCD = /ocd-division\/[^\s"'<>#,;)]+/i;

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
  return { ...normalized, reach: unionReach(normalized.reach, reachOf(normalized)) };
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

export function foldEntries(entries: readonly FieldManualEntry[]): FieldManualEntry[] {
  const byId = new Map<string, FieldManualEntry>();
  for (const entry of entries) byId.set(entry.id, mergeEntry(byId.get(entry.id) ?? null, entry));
  return [...byId.values()];
}

export const OUTCOME_RANK: Readonly<Record<FieldManualOutcome, number>> = {
  YIELDED: 0,
  REFERENCE: 1,
  ZERO: 2,
  BLOCKED: 3,
  FAILED: 4,
};

export interface FieldManualQuery {

  readonly subjectId?: string;

  readonly role?: FieldManualRole;

  readonly state?: string;
  readonly recordClass?: string;

  readonly platform?: string;

  readonly ocdIds?: readonly string[];
  readonly bodyIds?: readonly string[];

  readonly kinds?: readonly string[];

  readonly everywhere?: boolean;

  readonly limit?: number;
  readonly preferredRecordClasses?: readonly string[];
  readonly requiredExhaustedClasses?: readonly string[];
  readonly excludedKinds?: readonly string[];
}

export interface MethodEvidence {

  readonly here: readonly FixMapRow[];

  readonly works: Readonly<Record<string, MethodWorks>>;
}

export interface FieldManualProjection {

  readonly lines: readonly string[];

  readonly entryIds: readonly string[];

  readonly tiers: readonly number[];

  readonly leftOutFailingHere: number;

  readonly matched: number;
  readonly total: number;
}

function divisionApplies(scope: string, subject: string): boolean {
  const place = subject.toLowerCase().split("#")[0]!;
  return place === scope || place.startsWith(scope + "/");
}

function jobPlaces(query: FieldManualQuery): string[] {
  return [...(query.ocdIds ?? []).map((id) => id.toLowerCase().split("#")[0]!), ...(query.bodyIds ?? []).map((id) => `body:${id}`)];
}

export function coveringPlaces(query: Pick<FieldManualQuery, "ocdIds" | "bodyIds">): string[] {
  const out = new Set<string>();
  for (const id of query.ocdIds ?? []) {
    const parts = id.toLowerCase().split("#")[0]!.split("/");
    if(parts.length===1)out.add(parts[0]);
    for (let n = 2; n <= parts.length; n += 1) out.add(parts.slice(0, n).join("/"));
  }
  for (const id of query.bodyIds ?? []) out.add(`body:${id}`);
  return [...out].sort();
}

function placeMatches(places: readonly string[], query: FieldManualQuery): boolean {
  const job = jobPlaces(query);
  return places.some((scope) => job.some((place) => scope.startsWith("body:") ? scope === place : divisionApplies(scope, place)));
}

export function queryState(query: Pick<FieldManualQuery, "state" | "ocdIds">): string | undefined {
  return query.state?.toLowerCase() ?? (query.ocdIds ?? []).map(stateOfPlace).find((s): s is string => s !== null);
}

function reachOfStored(entry: FieldManualEntry): FieldManualReach {
  return entry.reach ?? reachOf(entry);
}

export function entryInSlice(entry: FieldManualEntry, query: FieldManualQuery): boolean {
  if (query.role !== undefined && entry.role !== "SHARED" && entry.role !== query.role) return false;
  if (query.kinds !== undefined && !query.kinds.includes(entry.kind)) return false;
  if (query.excludedKinds?.includes(entry.kind)) return false;
  if (query.recordClass !== undefined && entry.recordClasses.length > 0 && !entry.recordClasses.includes(query.recordClass.toLowerCase())) return false;

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
    (e.kind !== "EXHAUSTED_RUNGS" || (query.subjectId !== undefined && (e.payload as { subjectId?: string } | null)?.subjectId === query.subjectId &&
      (!query.requiredExhaustedClasses?.length || e.recordClasses.some(value=>query.requiredExhaustedClasses!.includes(value))))));
  const ranked = applicable.map((e) => rankEntry(e, query, evidence));
  const open = ranked.filter((r): r is Ranked => r !== null).sort((a, b) => {
    if(query.preferredRecordClasses!==undefined) {
      const helps=(entry:FieldManualEntry)=>entry.recordClasses.some(value=>query.preferredRecordClasses!.includes(value))?0:1;
      const preferred=helps(a.entry)-helps(b.entry);if(preferred)return preferred;
    }
    if (a.tier !== b.tier) return a.tier - b.tier;
    if(query.preferredRecordClasses!==undefined) {
      const anyClass=Number(a.entry.recordClasses.length>0)-Number(b.entry.recordClasses.length>0);if(anyClass)return anyClass;
    }
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

export function fieldManualLine(entry: FieldManualEntry): string {
  const where = entry.states.length > 0 ? entry.states.join("/").toUpperCase() : "portable";
  const on = entry.recordClasses.length > 0 ? ` [${entry.recordClasses.join(",")}]` : "";
  const door = entry.url ? ` <${entry.url}>` : "";
  const seen = entry.observedAt ? ` seen ${entry.observedAt.slice(0, 10)}` : "";
  return `${entry.role}/${entry.kind} ${entry.outcome} (${where})${on}: ${entry.title}${door} — ${entry.summary}${seen}`.replace(/\s+/g, " ").trim();
}

export type FieldManualRepos = Pick<ControlPlaneRepositories, "fieldManual"> & Partial<Pick<ControlPlaneRepositories, "fixMap" | "adminConfig">>;

export interface FieldManualRead {

  readonly projection: FieldManualProjection;

  readonly store: FieldManualStore;

  readonly evidence?: MethodEvidence;

  readonly error?: string;
}

export function fieldManualForSource(read: FieldManualRead, url: string): readonly FieldManualEntry[] {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return []; }
  return read.store.entries.filter(entry => {
    try { return entry.url !== null && new URL(entry.url).origin === origin; }
    catch { return false; }
  });
}

export function methodEvidencePlaces(query:FieldManualQuery):string[] {
  return [...new Set([...jobPlaces(query).filter(place=>!place.startsWith("body:")),...(query.ocdIds??[]).map(id=>id.split("#")[0])])];
}

export async function readMethodEvidence(repos: FieldManualRepos, entries: readonly FieldManualEntry[], query: FieldManualQuery): Promise<MethodEvidence | undefined> {
  if (!repos.fixMap) return undefined;
  const methods = entries.filter(isTransferableMethod).map((e) => e.id);
  const places = methodEvidencePlaces(query);
  const [here, works] = await Promise.all([
    Promise.all(methods.map(method => repos.fixMap!.forPlaces(method, places))).then(rows => rows.flat()),
    methods.length === 0 ? new Map<string, MethodWorks>() : repos.fixMap.worksFor(methods),
  ]);
  return { here, works: Object.fromEntries(works) };
}

export async function readFieldManualRows(repos: FieldManualRepos, query: FieldManualQuery = {}): Promise<FieldManualRead> {
  try {
    return await repos.fieldManual.select(query);
  } catch (error) {
    const store = emptyFieldManual();
    return { projection: projectFieldManual(store, query), store, error: error instanceof Error ? error.message : String(error) };
  }
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

const MERGE_ATTEMPTS = 32;

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
