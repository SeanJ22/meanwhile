import {
  fieldManualEntryId,
  fieldManualPlaceRank,
  normalizeEntry,
  emptyFieldManual,
  upsertEntries,
  readFieldManual,
  projectFieldManual,
  writeFieldManual,
  type FieldManualEntry,
  type FieldManualProjection,
  type FieldManualStore,
  type FieldManualRepos,
} from "../field-manual.ts";
import type { ScoutCandidate, ScoutResult } from "./scout-result.ts";
import { doorMethodEntries, type SavedDoorPage } from "../bank-methods.ts";
import { exhaustedRungEntries } from "../bank-exhausted-rungs.ts";
import { scoutJobCostEntries } from "../bank-job-cost.ts";

/** The source label a scout's own write-backs carry, so a re-observation updates one row. */
export const SCOUT_DISCOVERY_SOURCE = "scout-discovery";

const STATE_TOKEN = /\b(az|nh|nj|a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])\b/i;
const OCD_STATE = /state:([a-z]{2})/i;

/** The two-letter state(s) an obligation is about, from its OCD subject or its id. Empty = jurisdiction-agnostic. */
export function scoutStateHint(subjectId: string | null | undefined, obligationId: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const value of [subjectId, obligationId]) {
    if (!value) continue;
    const ocd = OCD_STATE.exec(value);
    if (ocd) out.add(ocd[1]!.toLowerCase());
    const tok = STATE_TOKEN.exec(value.replace(/^[a-z]+:/i, ""));
    if (tok) out.add(tok[1]!.toLowerCase());
  }
  return [...out];
}

/**
 * Project the manual down to what applies to a scout in this jurisdiction and
 * record class. Capped so a walk inherits a cache-cheap page of the most useful
 * doors, never the whole manual.
 */
export function scoutFieldManualProjection(
  store: FieldManualStore,
  opts: { readonly subjectId?: string | null; readonly obligationId?: string | null; readonly recordClass?: string | null; readonly limit?: number },
): FieldManualProjection {
  const states = scoutStateHint(opts.subjectId, opts.obligationId);
  // Rank applicable field hints first; cross-family methods keep the remaining slots.
  const related: Readonly<Record<string, readonly string[]>> = {
    OFFICIAL_ROSTER: ["officeholder", "roster", "contact", "verifiedpage", "photo", "body", "officials"],
    OFFICIAL_BOARD_DIRECTORY: ["body", "jurisdiction", "roster", "verifiedpage"],
    PUBLIC_COMMENT_RULE: ["meeting", "agenda", "minutes", "body", "verifiedpage"],
    CANDIDATE_FILING_DOCUMENT: ["candidate", "contest", "filing", "document"],
    CAMPAIGN_FINANCE_FILING: ["filing", "document", "contribution", "expenditure"],
  };
  const hints = new Set([opts.recordClass?.toLowerCase() ?? "", ...(related[opts.recordClass ?? ""] ?? [])]);
  // One state is the common case; portable entries remain available.
  const full = projectFieldManual(store, {
    role: "SCOUT", subjectId: opts.subjectId ?? undefined,
    ...(states[0] ? { state: states[0] } : {}),
    ...(opts.subjectId?.startsWith("ocd-division/") ? { ocdIds: [opts.subjectId] } : {}),
    limit: store.entries.length,
  });
  const byId = new Map(store.entries.map(entry => [entry.id, entry] as const));
  const indexed = full.entryIds.map((id, index) => ({ id, line: full.lines[index]!, entry: byId.get(id)! }))
    .filter(row => row.entry.kind !== "EXHAUSTED_RUNGS" || !opts.recordClass || row.entry.recordClasses.includes(opts.recordClass.toLowerCase()));
  indexed.sort((a, b) => {
    if (opts.subjectId?.startsWith("ocd-division/")) {
      const query = { ocdIds: [opts.subjectId], state: states[0] };
      const place = fieldManualPlaceRank(normalizeEntry(a.entry), query) - fieldManualPlaceRank(normalizeEntry(b.entry), query);
      if (place) return place;
    }
    const affinity = (entry: FieldManualEntry) => entry.recordClasses.some(value => hints.has(value.toLowerCase())) ? 0 : entry.recordClasses.length === 0 ? 1 : 2;
    return affinity(a.entry) - affinity(b.entry);
  });
  const chosen = indexed.slice(0, opts.limit ?? 30);
  return { lines: chosen.map(row => row.line), entryIds: chosen.map(row => row.id), matched: full.matched, total: full.total };
}

/** All state/role-applicable entries available to on-demand local search.
 * Only the capped projection goes into the model prompt; this catalog stays
 * outside that prefix until find_manual/read_manual is called. */
export function scoutFieldManualCatalog(
  store: FieldManualStore,
  opts: { readonly subjectId?: string | null; readonly obligationId?: string | null },
): readonly FieldManualEntry[] {
  const state = scoutStateHint(opts.subjectId, opts.obligationId)[0];
  const applicable = new Set(projectFieldManual(store, { role: "SCOUT", state, subjectId: opts.subjectId ?? undefined,
    ...(opts.subjectId?.startsWith("ocd-division/") ? { ocdIds: [opts.subjectId] } : {}), limit: store.entries.length }).entryIds);
  return store.entries.filter(entry => applicable.has(entry.id) || (entry.kind === "PLAYBOOK" && entry.role === "DETECTIVE"));
}

/** A projected door recorded as dead (BLOCKED or FAILED), from its rendered line (`<role>/<kind> <outcome> (...)`). */
const DEAD_DOOR_LINE = /^\S+\/\S+ (BLOCKED|FAILED) \(/;
/** An access control named on a door: the only thing that makes a dead door a wall. */
const ACCESS_CONTROL_NAMED = /\b(HTTP )?(401|402|403|407|429|451)\b|challenge|captcha|login|sign[- ]in|paywall|rate[- ]limit|forbidden|authenticat/i;
/** A robots.txt verdict named on a door. */
const ROBOTS_VERDICT_NAMED = /\b(DISALLOWED|CANNOT_TELL)\b|robots\.txt|permission (was )?(denied|unknown)/i;

/** Whether a dead door was recorded for robots.txt alone (no access control named). Such a door is not a wall, so the scout walks it. */
export function isRobotsOnlyDeadDoor(line: string): boolean {
  return DEAD_DOOR_LINE.test(line) && ROBOTS_VERDICT_NAMED.test(line) && !ACCESS_CONTROL_NAMED.test(line);
}

export function fieldManualBriefLines(projection: FieldManualProjection): string[] {
  if (projection.total === 0) return [];
  if (projection.entryIds.length === 0) {
    return [`FIELD MANUAL (${projection.total} entries): none apply to this jurisdiction/record class yet — you are opening a new branch.`];
  }
  const dead = projection.lines.some((l) => DEAD_DOOR_LINE.test(l));
  return [
    `FIELD MANUAL — ${projection.entryIds.length} inherited door(s) of ${projection.total}; walk what already worked before novelty, and do not rebuild a door already listed here:`,
    ...(dead
      ? [
          "  A BLOCKED or FAILED door is a wall only when an access control stopped it (a login or 401, a paywall, a 403 or bot challenge, a 429): never bypass it, walk another public route. " +
            "A door recorded dead for robots.txt alone is NOT a wall: robots.txt is recorded and never refuses a public page (owner decision 2026-09-25), so walk it.",
        ]
      : []),
    ...projection.lines.map((l) => `  • ${l}${isRobotsOnlyDeadDoor(l) ? " [robots.txt only — not a wall; walk it]" : ""}`),
  ];
}

/**
 * A scout's grounded candidates, as field-manual entries to write back live.
 * Only candidates the Attempt actually opened become YIELDED doors; the store's
 * own upsert dedups by id so a re-discovery refreshes rather than forks.
 */
export function scoutDiscoveryEntries(result: ScoutResult, stateHint: readonly string[], pages: readonly SavedDoorPage[] = []): FieldManualEntry[] {
  const rejected = new Set((result.sourceDeadEnds ?? []).map(source => source.artifactId));
  const discoveries: FieldManualEntry[] = (result.refusal === null ? result.candidates : []).filter(c =>
    !c.evidenceArtifactIds.some(id => rejected.has(id))).map((c: ScoutCandidate) => ({
    id: fieldManualEntryId(SCOUT_DISCOVERY_SOURCE, `${result.subjectId}:${c.routeId}`),
    role: "SCOUT",
    kind: "SCOUT_DISCOVERY",
    title: c.title,
    summary: `${c.procedure} — ${c.relevance}`.slice(0, 300),
    states: [...stateHint],
    recordClasses: [c.recordClass],
    platforms: [],
    foundBy: result.researchRole === "DETECTIVE" ? "DETECTIVE" : "SCOUT",
    outcome: "YIELDED",
    url: c.url,
    source: SCOUT_DISCOVERY_SOURCE,
    observedAt: (result.recordedAt ?? "").slice(0, 10) || null,
    tier: null,
    payload: {
      routeId: c.routeId,
      url: c.url,
      procedure: c.procedure,
      permission: c.permission,
      recordClass: c.recordClass,
      obligationId: result.obligationId,
      subjectId: result.subjectId,
      attemptId: result.attemptId,
      evidenceArtifactIds: c.evidenceArtifactIds,
    },
  }));
  const methods = discoveries.flatMap(door => doorMethodEntries(door, pages));
  const stamped = discoveries.map(door => ({ ...door, platforms: methods.filter(method =>
    (method.payload as { doorEntryIds: string[] }).doorEntryIds.includes(door.id)).flatMap(method => method.platforms) }));
  return [...stamped, ...methods, ...scoutJobCostEntries(result), ...exhaustedRungEntries(result, stateHint), ...(result.sourceDeadEnds ?? []).map(source => ({
    id: fieldManualEntryId('source-dead-end', `${result.subjectId}:${result.recordClass}:${source.url}`),
    role: 'SHARED' as const, kind: 'SOURCE_DEAD_END', title: `Historical source: ${source.url}`,
    summary: `${source.sourceDate ?? 'Unknown source date'}: ${source.reason}`.slice(0, 300),
    states: [...stateHint], recordClasses: [result.recordClass], platforms: [], outcome: 'FAILED' as const,
    url: source.url, source: 'source-dead-end', observedAt: result.recordedAt, tier: null,
    payload: { ...source, subjectId: result.subjectId, recordClass: result.recordClass, attemptId: result.attemptId },
  }))];
}

/** Every route id the manual already holds; a newly built candidate matching one is a rebuilt-existing defect. */
export function knownRouteIds(store: FieldManualStore): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const e of store.entries) {
    const p = e.payload as { routeId?: unknown; id?: unknown } | null | undefined;
    const rid = typeof p?.routeId === "string" ? p.routeId : typeof p?.id === "string" ? p.id : null;
    if (rid) ids.add(rid);
  }
  return ids;
}

/** The reported pair for one walk: inherited doors offered, newly built, and any rebuilt-existing defect. */
export interface CompoundingPair {
  readonly inheritedCount: number;
  readonly newlyBuilt: number;
  readonly rebuiltExisting: readonly string[];
}

export function compoundingPair(
  inheritedCount: number,
  result: ScoutResult,
  known: ReadonlySet<string>,
): CompoundingPair {
  const rebuilt = result.candidates.map((c) => c.routeId).filter((id) => known.has(id));
  return { inheritedCount, newlyBuilt: result.candidates.length, rebuiltExisting: rebuilt };
}

/** A URL or route id, compared loosely: host case, a trailing slash and a fragment never make two doors different. */
function doorKey(value: string): string {
  const trimmed = value.trim();
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return trimmed;
  }
}

/** Which inherited doors the walk actually went through: only a successful machine-recorded rung on the URL or route id counts, once per door. */
export function usedFieldManualEntryIds(result: ScoutResult, handedIds: readonly string[], store: FieldManualStore): string[] {
  if (handedIds.length === 0) return [];
  const walked = new Set<string>(result.rungs.filter(rung => rung.ok === true &&
    ["fetch_public", "browse"].includes(rung.tool)).flatMap(rung => [doorKey(rung.target), doorKey(rung.rung)]));
  const byId = new Map(store.entries.map((e) => [e.id, e] as const));
  const creditedDoors = new Set<string>();
  return handedIds.filter((id) => {
    const entry = byId.get(id);
    if (entry === undefined) return false;
    const routeId = (entry.payload as { routeId?: unknown } | null | undefined)?.routeId;
    const urlKey = typeof entry.url === "string" && entry.url !== "" ? doorKey(entry.url) : null;
    const routeKey = typeof routeId === "string" && routeId !== "" ? doorKey(routeId) : null;
    const matched = [urlKey, routeKey].find((key): key is string => key !== null && walked.has(key));
    if (!matched) return false;
    const door = urlKey ?? routeKey ?? matched;
    if (creditedDoors.has(door)) return false;
    creditedDoors.add(door);
    return true;
  });
}

export async function writeFieldManualDiscoveries(repos: FieldManualRepos, entries: readonly FieldManualEntry[], now: string) {
  const bank = await readFieldManual(repos);
  const methods = entries.flatMap(door => doorMethodEntries(door, [], bank.store.entries));
  const folded = upsertEntries(emptyFieldManual(), [...entries, ...methods], now);
  return writeFieldManual(repos, folded.entries, now);
}
