/** A figure this read does not have is null ("—"), never zero. Held data is read once for the whole list, never once per row. */
import { buildPlaceOwedList } from "../../coverage/place-owed.ts";
import type { HeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { BillingAttribution } from "../provider-billing-attribution.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { placeKeyOfRow, stateOfRow, type StuckRowLike } from "./blocker-causes.ts";
import { placePercent } from "../../coverage/place-measures.ts";
import { exactHuntAccounting, sectionRevision, validateV6Query, type AdminV6SectionEnvelope, type V6PlaceScope, type V6Refusal } from "./v6-hunts-read.ts";
import { districtAlways, stateDivisionId, unionDivisions, type DistrictInfo, type DistrictsRead, type NationalDivision } from "./v6-national-geography.ts";

export const ADMIN_V6_NATIONAL_CONTRACT = "admin-v6/national@1" as const;

export type NationalRowKind = "State" | "District" | "ZIP";

/** Structurally `StateRow` in app/(admin)/_mw/admin-v6/model.ts, without importing the UI bundle. */
export interface AdminV6NationalRow {
  readonly placeKey: string;
  readonly code: string;
  readonly name: string;
  readonly hunts: number | null;
  readonly stuck: number | null;
  /** The published snapshot carries no per-state item count, so this is always unknown here. */
  readonly checklistItems: number | null;
  readonly tracked: boolean;
  readonly kind: NationalRowKind;
  readonly parentKey: string;
  readonly zipsWorked: number | null;
  readonly zipsTotal: number | null;
  /** Floored to one decimal, as the place score is; null when not measured. */
  readonly score: number | null;
}

export function nationalScopeOf(params: URLSearchParams): { readonly ok: true; readonly scopeKey: string; readonly scope: V6PlaceScope } | { readonly ok: false; readonly code: string } {
  const query = validateV6Query(params);
  if (!query.ok) return query;
  return query.scope === null ? { ok: false, code: "INVALID_SCOPE" } : { ok: true, scopeKey: query.scopeKey, scope: query.scope };
}

export interface NationalHuntSources {
  readonly scopes: readonly ExpansionScopeDecision[] | null;
  readonly malformedScopes: number;
  readonly attribution: BillingAttribution | null | undefined;
}

interface HuntFact {
  readonly state: string;
  readonly type: string;
  readonly geoid: string;
  /** Spent money or recorded any charge; null when the accounting for this hunt is not published (unknown, not "no"). */
  readonly worked: boolean | null;
}

function huntFacts(hunts: NationalHuntSources): readonly HuntFact[] | null {
  if (hunts.scopes === null || hunts.malformedScopes > 0) return null;
  return hunts.scopes.filter((d) => typeof d.budgetStartedAt === "string").map((d): HuntFact => {
    const row = exactHuntAccounting(hunts.attribution, d);
    const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
    const worked = row === null ? null : num(row.budgetConsumedKnownUsd) > 0 || num(row.knownCombinedUsd) > 0 || num(row.budgetUnpriced) > 0 || num(row.unpriced) > 0;
    return { state: d.geography.stateAbbr.toLowerCase(), type: d.geography.type, geoid: d.geography.geoid, worked };
  });
}

function zipsWorkedOf(zipHunts: readonly HuntFact[]): number | null {
  const byZip = new Map<string, boolean | null>();
  for (const h of zipHunts) {
    const prior = byZip.get(h.geoid);
    byZip.set(h.geoid, prior === true || h.worked === true ? true : prior === null || h.worked === null ? null : false);
  }
  const values = [...byZip.values()];
  return values.includes(null) ? null : values.filter((v) => v === true).length;
}

function stuckIndex(rows: readonly StuckRowLike[] | null): { byState: ReadonlyMap<string, ReadonlySet<string>>; byPlace: ReadonlyMap<string, ReadonlySet<string>> } | null {
  if (rows === null) return null;
  const byState = new Map<string, Set<string>>(), byPlace = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, id: string) => m.set(k, (m.get(k) ?? new Set<string>()).add(id));
  for (const row of rows) {
    const st = stateOfRow(row);
    if (st !== null) add(byState, st, row.id);
    add(byPlace, placeKeyOfRow(row), row.id);
  }
  return { byState, byPlace };
}

export interface NationalInputs {
  readonly scope: V6PlaceScope;
  readonly hunts: NationalHuntSources;
  readonly stuck: readonly StuckRowLike[] | null;
  readonly zipCounts: ReadonlyMap<string, number> | null;
  readonly districts: readonly DistrictInfo[] | null;
  /** Place score by place key; a key absent or null is "—". */
  readonly scores: ReadonlyMap<string, number | null>;
}

const COUNTRY = "us";

export function nationalRows(inputs: NationalInputs): readonly AdminV6NationalRow[] {
  const facts = huntFacts(inputs.hunts);
  const stuck = stuckIndex(inputs.stuck);
  const score = (key: string) => inputs.scores.get(key) ?? null;
  const pilot = new Map(US_STATES.map((s) => [s.code, s.pilot]));
  const scope = inputs.scope;

  if (scope.kind === "country") {
    return US_STATES.map((s): AdminV6NationalRow => {
      const inState = facts?.filter((h) => h.state === s.code) ?? null;
      return { placeKey: `st:${s.code}`, code: s.code.toUpperCase(), name: s.name, kind: "State", parentKey: COUNTRY, tracked: s.pilot, checklistItems: null,
        hunts: inState === null ? null : inState.length,
        zipsTotal: inputs.zipCounts?.get(s.code) ?? null,
        zipsWorked: inState === null ? null : zipsWorkedOf(inState.filter((h) => h.type === "zcta")),
        score: score(`st:${s.code}`),
        stuck: stuck === null ? null : stuck.byState.get(s.code)?.size ?? 0 };
    });
  }

  if (scope.kind === "state") {
    if (inputs.districts === null) return [];
    return inputs.districts.map((d): AdminV6NationalRow => {
      const zips = new Set(d.zips);
      const inDistrict = facts?.filter((h) => h.state === d.state && ((h.type === "zcta" && zips.has(h.geoid)) || (h.type === "congressional_district" && h.geoid === d.geoid))) ?? null;
      const stuckIds = new Set<string>();
      if (stuck !== null) for (const z of d.zips) for (const id of stuck.byPlace.get(`geo:${d.state}.zcta.${z}`) ?? []) stuckIds.add(id);
      return { placeKey: d.placeKey, code: d.label, name: d.label, kind: "District", parentKey: `st:${d.state}`, tracked: pilot.get(d.state) ?? false, checklistItems: null,
        hunts: inDistrict === null ? null : inDistrict.length,
        zipsTotal: d.zips.length,
        zipsWorked: inDistrict === null ? null : zipsWorkedOf(inDistrict.filter((h) => h.type === "zcta")),
        score: score(d.placeKey),
        stuck: stuck === null ? null : stuckIds.size };
    });
  }

  if (scope.type !== "congressional_district") return [];
  const district = inputs.districts?.find((d) => d.geoid === scope.geoid && d.state === scope.state) ?? null;
  if (district === null) return [];
  return district.zips.map((zip): AdminV6NationalRow => {
    const key = `geo:${district.state}.zcta.${zip}`;
    const own = facts?.filter((h) => h.state === district.state && h.type === "zcta" && h.geoid === zip) ?? null;
    return { placeKey: key, code: zip, name: `ZIP ${zip}`, kind: "ZIP", parentKey: district.placeKey, tracked: pilot.get(district.state) ?? false, checklistItems: null,
      hunts: own === null ? null : own.length,
      zipsTotal: 1,
      zipsWorked: own === null ? null : zipsWorkedOf(own),
      score: score(key),
      stuck: stuck === null ? null : stuck.byPlace.get(key)?.size ?? 0 };
  });
}

export interface ScoreTarget {
  readonly placeKey: string;
  readonly divisions: readonly NationalDivision[];
  readonly zips?: readonly string[];
}

export interface ScoreDeps {
  readonly now: () => string;
  readonly readHeld: (divisionIds: readonly string[], now: string) => Promise<HeldPlaceCapture>;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Each target's owed list is built in memory over its own divisions, so its number is exactly what `readPlaceOwed` gives that place alone. */
export async function scoreTargets(targets: readonly ScoreTarget[], deps: ScoreDeps): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (targets.length === 0) return out;
  const now = deps.now();
  const held = await deps.readHeld([...new Set(targets.flatMap((t) => t.divisions.map((d) => d.id)))], now);
  for (const target of targets) {
    const rows = buildPlaceOwedList({ divisions: target.divisions, subjects: held.subjects, held: held.held, now, ...(target.zips ? { zips: target.zips } : {}) });
    out.set(target.placeKey, placePercent(rows));
    await tick();
  }
  return out;
}

const MEMO_MS = 5 * 60_000;
const MEMO_SCOPES = 24;
const MAX_SCORING = 2;
const scoreMemo = new Map<string, { at: number; scores: ReadonlyMap<string, number | null> }>();
const scoring = new Map<string, Promise<ReadonlyMap<string, number | null>>>();
let active = 0;
const queued: (() => void)[] = [];

async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_SCORING) await new Promise<void>((resolve) => queued.push(resolve));
  active += 1;
  try { return await run(); }
  finally {
    active -= 1;
    queued.shift()?.();
  }
}

export function forgetNationalScores(): void {
  scoreMemo.clear();
  scoring.clear();
}

export async function scoresWithin(scopeKey: string, build: () => Promise<readonly ScoreTarget[]>, deps: ScoreDeps, budgetMs: number): Promise<{ readonly scores: ReadonlyMap<string, number | null>; readonly ready: boolean }> {
  const hit = scoreMemo.get(scopeKey);
  if (hit && Date.now() - hit.at < MEMO_MS) return { scores: hit.scores, ready: true };
  let read = scoring.get(scopeKey);
  if (read === undefined) {
    read = limited(async () => scoreTargets(await build(), deps)).then((scores) => {
      scoreMemo.set(scopeKey, { at: Date.now(), scores });
      while (scoreMemo.size > MEMO_SCOPES) scoreMemo.delete(scoreMemo.keys().next().value as string);
      return scores;
    }).finally(() => scoring.delete(scopeKey));
    scoring.set(scopeKey, read);
    read.catch(() => undefined);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const none = { scores: new Map<string, number | null>() as ReadonlyMap<string, number | null>, ready: false };
  const result = await Promise.race([
    read.then((scores) => ({ scores, ready: true }), () => none),
    new Promise<typeof none>((resolve) => { timer = setTimeout(() => resolve(none), budgetMs); }),
  ]);
  clearTimeout(timer);
  return result;
}

export interface NationalDeps extends ScoreDeps {
  readonly districts: (state: string) => Promise<DistrictsRead>;
  readonly zipCounts: () => Promise<ReadonlyMap<string, number> | null>;
  readonly zipDivisions: (zips: readonly string[]) => Promise<ReadonlyMap<string, readonly string[]>>;
  readonly scoreBudgetMs: number;
}

export interface NationalSources {
  readonly hunts: NationalHuntSources;
  readonly stuck: readonly StuckRowLike[] | null;
}

async function targetsOf(scope: V6PlaceScope, districts: readonly DistrictInfo[] | null, deps: NationalDeps): Promise<readonly ScoreTarget[]> {
  if (scope.kind === "country") {
    return US_STATES.flatMap((s) => {
      const id = stateDivisionId(s.code);
      return id === null ? [] : [{ placeKey: `st:${s.code}`, divisions: [{ id, label: s.code.toUpperCase() }] }];
    });
  }
  if (districts === null) return [];
  if (scope.kind === "state") {
    const ids = await deps.zipDivisions(districts.flatMap((d) => d.zips));
    return districts.map((d) => ({ placeKey: d.placeKey, zips: d.zips, divisions: unionDivisions(d.zips.map((z) => ids.get(z) ?? []), districtAlways(d)) }));
  }
  const district = districts.find((d) => d.geoid === scope.geoid && d.state === scope.state);
  if (district === undefined) return [];
  const ids = await deps.zipDivisions(district.zips);
  return district.zips.map((z) => ({ placeKey: `geo:${district.state}.zcta.${z}`, zips: [z], divisions: unionDivisions([ids.get(z) ?? []], districtAlways(district)) }));
}

/** A state whose districts cannot be read answers a refusal, never an empty list. */
export async function v6NationalSection(input: { readonly scopeKey: string; readonly scope: V6PlaceScope; readonly sources: NationalSources; readonly deps: NationalDeps }): Promise<AdminV6SectionEnvelope<readonly AdminV6NationalRow[]> | V6Refusal> {
  const { scope, deps, sources } = input;
  const state = scope.kind === "country" ? null : scope.state;
  const districtsRead = state === null || (scope.kind === "geo" && scope.type !== "congressional_district") ? null : await deps.districts(state);
  if (districtsRead !== null && !districtsRead.ok) {
    return { kind: "refused", status: districtsRead.code === "DISTRICT_PLAN_AMBIGUOUS" ? 409 : 503, code: districtsRead.code, says: districtsRead.says };
  }
  const districts = districtsRead === null ? null : districtsRead.districts;
  const wantsScores = scope.kind !== "geo" || scope.type === "congressional_district";
  const [zipCounts, scored] = await Promise.all([
    scope.kind === "country" ? deps.zipCounts() : Promise.resolve(null),
    wantsScores ? scoresWithin(input.scopeKey, () => targetsOf(scope, districts, deps), deps, deps.scoreBudgetMs)
      : Promise.resolve({ scores: new Map<string, number | null>() as ReadonlyMap<string, number | null>, ready: true }),
  ]);
  const data = nationalRows({ scope, hunts: sources.hunts, stuck: sources.stuck, zipCounts, districts, scores: scored.scores });
  const missingParts = [
    ...(sources.hunts.scopes === null ? ["The saved hunt list could not be read, so hunts and ZIPs worked are unknown."]
      : sources.hunts.malformedScopes > 0 ? ["Some saved scope entries could not be read, so hunts and ZIPs worked are unknown."] : []),
    ...(sources.stuck === null ? ["The published work index could not be read, so stuck counts are unknown."] : []),
    ...(scope.kind === "country" && zipCounts === null ? ["The national ZIP index could not be read, so ZIP totals are unknown."] : []),
    ...(scored.ready ? [] : ["Place scores are still being read."]),
  ];
  const asOf = deps.now();
  return { contract: ADMIN_V6_NATIONAL_CONTRACT, scope: input.scopeKey, revision: sectionRevision("national", { data, missingParts }), asOf, data, missingParts };
}

