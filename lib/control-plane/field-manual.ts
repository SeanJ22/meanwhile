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
 * This module is pure (no db, fs, clock, or source-type imports) so the exact
 * projection and grow-only rules are tested without a database, and so the
 * heavy source adapters live in the seed/write callers, not here.
 */

import { createHash } from "node:crypto";

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
  readonly outcome: FieldManualOutcome;
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

/** Normalise an entry's hint arrays so projection and dedup are order-insensitive. */
export function normalizeEntry(entry: FieldManualEntry): FieldManualEntry {
  return {
    ...entry,
    states: lower(entry.states),
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
      observedAt: nextAt >= priorAt ? entry.observedAt : prior.observedAt,
    });
  }
  return { formatVersion: 1, updatedOn: now, entries: [...byId.values()] };
}

const OUTCOME_RANK: Readonly<Record<FieldManualOutcome, number>> = {
  YIELDED: 0,
  REFERENCE: 1,
  ZERO: 2,
  BLOCKED: 3,
  FAILED: 4,
};

export interface FieldManualQuery {
  /** The reading worker's role; SHARED entries always match. Omit to match every role. */
  readonly role?: FieldManualRole;
  /** Lowercase two-letter state; a portable ([]-state) entry always matches. */
  readonly state?: string;
  readonly recordClass?: string;
  readonly platform?: string;
  /** Hard cap on projected lines so a walk's context stays a cache-cheap projection, never the whole store. */
  readonly limit?: number;
}

export interface FieldManualProjection {
  /** The projectable lines, most-applicable first. What the worker reads. */
  readonly lines: readonly string[];
  /** The entry ids offered — the "inherited branches" half of the RULING 63 pair. */
  readonly entryIds: readonly string[];
  /** How many entries matched before the limit; total how many the store holds. */
  readonly matched: number;
  readonly total: number;
}

function entryMatches(entry: FieldManualEntry, q: FieldManualQuery): boolean {
  if (q.role !== undefined && entry.role !== "SHARED" && entry.role !== q.role) return false;
  if (q.state !== undefined && entry.states.length > 0 && !entry.states.includes(q.state.toLowerCase())) return false;
  if (q.recordClass !== undefined && entry.recordClasses.length > 0 && !entry.recordClasses.includes(q.recordClass.toLowerCase())) return false;
  if (q.platform !== undefined && entry.platforms.length > 0 && !entry.platforms.includes(q.platform.toLowerCase())) return false;
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
  const matched = store.entries.filter((e) => entryMatches(e, query));
  const ranked = [...matched].sort((a, b) => {
    const outcome = OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome];
    if (outcome !== 0) return outcome;
    const aSpecific = query.state !== undefined && a.states.includes(query.state.toLowerCase()) ? 0 : 1;
    const bSpecific = query.state !== undefined && b.states.includes(query.state.toLowerCase()) ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    const freshness = (b.observedAt ?? "").localeCompare(a.observedAt ?? "");
    if (freshness !== 0) return freshness;
    return a.id.localeCompare(b.id);
  });
  const chosen = ranked.slice(0, limit);
  return {
    lines: chosen.map((e) => fieldManualLine(e)),
    entryIds: chosen.map((e) => e.id),
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
