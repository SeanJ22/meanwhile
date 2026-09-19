/**
 * **THE SCOUT'S DOOR INTO THE FIELD MANUAL.** (Owner directive 2026-09-19.)
 *
 * A scout READS a projection of the field manual before it walks (the inherited
 * half of the RULING 63 pair) and WRITES its grounded discoveries straight back
 * — no human `method:learn` step between finding a door and the next scout
 * seeing it. This module is the small bridge between the scout result shape and
 * the field-manual store, kept out of the pure store module so that stays free
 * of scheduler types.
 */

import {
  emptyFieldManual,
  fieldManualEntryId,
  projectFieldManual,
  upsertEntries,
  type FieldManualEntry,
  type FieldManualProjection,
  type FieldManualStore,
} from "../field-manual.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ScoutCandidate, ScoutResult } from "./scout-result.ts";

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
  // One state is the common case; if a subject spans two we project the first,
  // and portable ([]-state) entries always match regardless.
  return projectFieldManual(store, {
    role: "SCOUT",
    ...(states[0] ? { state: states[0] } : {}),
    ...(opts.recordClass ? { recordClass: opts.recordClass } : {}),
    limit: opts.limit ?? 30,
  });
}

/** The brief lines a scout reads, with the RULING 63 header naming the manual it inherited. */
export function fieldManualBriefLines(projection: FieldManualProjection): string[] {
  if (projection.total === 0) return [];
  if (projection.entryIds.length === 0) {
    return [`FIELD MANUAL (${projection.total} entries): none apply to this jurisdiction/record class yet — you are opening a new branch.`];
  }
  return [
    `FIELD MANUAL — ${projection.entryIds.length} inherited door(s) of ${projection.total}; walk what already worked before novelty, and do not rebuild a door already listed here (RULING 63):`,
    ...projection.lines.map((l) => `  • ${l}`),
  ];
}

/**
 * A scout's grounded candidates, as field-manual entries to write back live.
 * Only candidates the Attempt actually opened become YIELDED doors; the store's
 * own upsert dedups by id so a re-discovery refreshes rather than forks.
 */
export function scoutDiscoveryEntries(result: ScoutResult, stateHint: readonly string[]): FieldManualEntry[] {
  return result.candidates.map((c: ScoutCandidate) => ({
    id: fieldManualEntryId(SCOUT_DISCOVERY_SOURCE, c.routeId),
    role: "SCOUT",
    kind: "SCOUT_DISCOVERY",
    title: c.title,
    summary: `${c.procedure} — ${c.relevance}`.slice(0, 300),
    states: [...stateHint],
    recordClasses: [c.recordClass],
    platforms: [],
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
      attemptId: result.attemptId,
      evidenceArtifactIds: c.evidenceArtifactIds,
    },
  }));
}

/** Every route id the manual already holds — a newly-built candidate that matches one is a rebuilt-existing defect (RULING 63). */
export function knownRouteIds(store: FieldManualStore): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const e of store.entries) {
    const p = e.payload as { routeId?: unknown; id?: unknown } | null | undefined;
    const rid = typeof p?.routeId === "string" ? p.routeId : typeof p?.id === "string" ? p.id : null;
    if (rid) ids.add(rid);
  }
  return ids;
}

/** The RULING 63 reported pair for one walk: inherited doors offered, newly built, and any rebuilt-existing defect. */
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

/**
 * Write a scout's discoveries into the growing field manual, live, with the
 * store's own CAS to survive a concurrent write. A write-back failure is a fact
 * about our store, returned to the caller — never an uncaught crash that would
 * lose the scout result that was already learned.
 */
export async function writeFieldManualDiscoveries(
  repos: Pick<ControlPlaneRepositories, "fieldManual">,
  entries: readonly FieldManualEntry[],
  now: string,
): Promise<{ readonly written: number; readonly error?: string }> {
  if (entries.length === 0) return { written: 0 };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const current = await repos.fieldManual.read("live");
      const next = upsertEntries(current?.value ?? emptyFieldManual(), entries, now);
      if (current === null) await repos.fieldManual.put("live", next, now);
      else await repos.fieldManual.compareAndSet("live", current.revision, next, now);
      return { written: entries.length };
    } catch (error) {
      if (attempt === 3) return { written: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { written: 0 };
}
