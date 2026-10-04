/**
 * **AUDITORS RE-READ LIVE FACTS AFTER THEY PUBLISH.** (DP-13; design §6.9.)
 *
 * Until now an auditor ran only for judgment calls, so most published facts
 * were never looked at again. This is the live-audit pass: each pass it
 * samples published facts a few at a time from each area, re-reads each
 * fact's own source page, and re-runs the §3 value-on-page check and a date
 * check on what the page says today. The answer is green or red, with the fact
 * ID and the page that was read.
 *
 * - **Never loads a whole read model.** The catalog hands over areas and then a
 *   few facts of one area at a time.
 * - **A routine refresh counts.** If the routine refresh already re-read the
 *   same source and found it unchanged since the fact was verified, that is a
 *   green flag with no new fetch. Fetches go only where refreshes don't reach.
 * - **Unchecked is not broken.** A page that cannot be read, or a fact with
 *   nothing on it we can look for, is INCONCLUSIVE, never red.
 * - **Plain pacing.** Re-reads go through the caller's fetch (the acquirer
 *   toolkit, which spaces requests per host); this module adds no request path
 *   of its own and never calls a model.
 *
 * Sampling rules start as the code default below; DP-17 moves them into the
 * audit policy setting. Everything here is pure or takes its reads, clock and
 * store as arguments, so tests prove it without a network or a database.
 */
import { createHash } from "node:crypto";
import { pageWords, valueOnPage, FRESHNESS_WINDOW_HOURS, SECTION3_LABEL_FIELDS } from "../promotion/section3.ts";
import { boostReason, type SampleBoosts } from "./audit-sampling.ts";

/** One published fact as the audit needs it: a record from a live read model. */
export interface LiveFact {
  /** Stable across passes: `<family>:<record id>`. This is the fact ID in every result. */
  readonly id: string;
  /** The read-model family it was published through, for the result and for per-family counts. */
  readonly family: string;
  /** The area the sample is spread across (a body, a division, a ZIP, a state). */
  readonly area: string;
  /** The page the fact was verified against. */
  readonly sourceUrl: string;
  /** The published record itself. */
  readonly record: Readonly<Record<string, unknown>>;
  /** When the fact was last verified against its page. */
  readonly verifiedAt: string | null;
  /** Content hash of the page at verification, when known; lets a refresh show "unchanged". */
  readonly verifiedContentHash?: string | null;
  /** The kind of fact, for its freshness window; the family's own window when absent. */
  readonly recordClass?: string;
  /** Distinct source pages the fact rests on; 1 when it rests on one. */
  readonly sourceCount?: number;
}

export interface LiveFactCatalog {
  /** Every area that has published facts. Small: names only. */
  areas(): Promise<readonly string[]>;
  /** Up to `limit` facts of one area. Never the whole read model. */
  factsInArea(area: string, limit: number): Promise<readonly LiveFact[]>;
}

export interface LiveAuditPolicy {
  /** Facts audited per area per pass. */
  readonly perAreaPerPass: number;
  /** Areas looked at per pass, so one pass stays small however many areas exist. */
  readonly areasPerPass: number;
  /** A fact audited more recently than this is passed over. */
  readonly minHoursBetweenAudits: number;
  /** The most facts one area hands the sampler to choose from. */
  readonly poolPerArea: number;
  /** A routine refresh newer than this, and unchanged, stands in for a re-read. */
  readonly refreshMaxAgeHours: number;
  /** The most new fetches one pass makes. */
  readonly maxFetchesPerPass: number;
  /** Extra facts an area gets when it holds past-refresh or high-demand facts (DP-16). */
  readonly boostExtraPerArea: number;
  /** A boosted fact may be audited again after this long, sooner than an ordinary one. */
  readonly boostedMinHoursBetweenAudits: number;
}

export const LIVE_AUDIT_DEFAULT_POLICY: LiveAuditPolicy = {
  perAreaPerPass: 1,
  areasPerPass: 40,
  minHoursBetweenAudits: 7 * 24,
  poolPerArea: 50,
  refreshMaxAgeHours: 36,
  maxFetchesPerPass: 60,
  boostExtraPerArea: 1,
  boostedMinHoursBetweenAudits: 48,
};

export type LiveAuditVerdict = "GREEN" | "RED" | "INCONCLUSIVE";

export interface LiveAuditCheck {
  readonly field: string;
  readonly kind: "VALUE_ON_PAGE" | "DATE_ON_PAGE";
  readonly ok: boolean;
  /** What the record says, trimmed for the result. */
  readonly value: string;
}

/** Why a fact was picked: the boost that applied, or the ordinary rotation. The audit card splits the sample by this. */
export type PickReason = "PAST_REFRESH" | "DEMAND" | "SINGLE_SOURCE" | "ROUTINE";

export interface LiveAuditResult {
  /** Why this fact was in the sample. */
  readonly pickedBecause: PickReason;
  readonly factId: string;
  readonly family: string;
  readonly area: string;
  readonly verdict: LiveAuditVerdict;
  readonly checkedAt: string;
  /** The page that was read (or the refresh's page for an unchanged-refresh green). */
  readonly sourceUrl: string;
  readonly reread: { readonly url: string; readonly retrievedAt: string; readonly contentHash: string; readonly artifactId: string | null } | null;
  /** How the verdict was reached. */
  readonly basis: "REREAD" | "UNCHANGED_ROUTINE_REFRESH" | "NOT_READ";
  readonly checks: readonly LiveAuditCheck[];
  /** One plain sentence. */
  readonly reason: string;
}

export interface PageRead {
  readonly url: string;
  readonly text: string;
  readonly retrievedAt: string;
  readonly contentHash: string;
  readonly artifactId?: string | null;
}

export interface RoutineRefresh {
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly contentHash: string;
}

// --- which values of a record are audited --------------------------------

/** Parts of a record that are bookkeeping, links back to us or categories, not statements the page makes. */
const NOT_PAGE_STATEMENTS = new Set([
  "id", "kind", "bodyId", "ocdId", "sourceUrl", "sourceOrg", "collectedAt", "verifiedAt", "verification", "fieldSources",
  "formatVersion", "carried", "provenance", "sourceReceipt", "retainedFromVersion", "topicId", "serviceAreaEvidence", "coverageEvidence",
  "label", "match", "lat", "lng", "timeZone",
]);

/**
 * The (field, value) pairs of a record that the page itself should show: its own
 * string and number fields, one level of nested object (a contact, a value), no
 * bookkeeping, no category labels. A record that carries `fieldSources` is
 * audited on the fields whose source is the page being re-read.
 */
export function auditableFields(record: Readonly<Record<string, unknown>>, sourceUrl: string): { field: string; value: string | number }[] {
  const sourced = record.fieldSources as Record<string, { sourceUrl?: string }> | undefined;
  const out: { field: string; value: string | number }[] = [];
  const take = (field: string, value: unknown) => {
    if (typeof value === "string" && value.trim() && value.length <= 600) out.push({ field, value });
    else if (typeof value === "number" && Number.isFinite(value)) out.push({ field, value });
  };
  for (const [field, value] of Object.entries(record)) {
    if (NOT_PAGE_STATEMENTS.has(field) || SECTION3_LABEL_FIELDS.includes(field)) continue;
    if (sourced && sourced[field] && sourced[field].sourceUrl !== sourceUrl) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (NOT_PAGE_STATEMENTS.has(inner) || SECTION3_LABEL_FIELDS.includes(inner)) continue;
        take(`${field}.${inner}`, innerValue);
      }
    } else take(field, value);
  }
  return out;
}

// --- dates ---------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

/** A value that is a calendar date or date-time (ISO). */
export function isoDateParts(value: unknown): { y: number; m: number; d: number } | null {
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { y, m: mo, d } : null;
}

/**
 * Whether the page shows this calendar date in any of the forms a government
 * page uses: "October 5, 2026", "Oct. 5, 2026", "5 October 2026", "10/5/2026",
 * "10/05/26", "2026-10-05". Numbers are matched on word boundaries so "10/5/2026"
 * never matches inside "110/5/20267".
 */
export function dateOnPage(parts: { y: number; m: number; d: number }, words: string): boolean {
  const { y, m, d } = parts;
  const month = MONTHS[m - 1];
  const short = month.slice(0, 3);
  const yy = String(y).slice(2);
  const dd = String(d).padStart(2, "0"), mm = String(m).padStart(2, "0");
  const forms = [
    `${month} ${d}, ${y}`, `${month} ${d} ${y}`, `${month} ${dd}, ${y}`, `${short} ${d}, ${y}`, `${short}. ${d}, ${y}`, `${short} ${d} ${y}`,
    `${d} ${month} ${y}`, `${d} ${short} ${y}`, `${month} ${d}th, ${y}`, `${month} ${d}st, ${y}`, `${month} ${d}nd, ${y}`, `${month} ${d}rd, ${y}`,
    `${m}/${d}/${y}`, `${mm}/${dd}/${y}`, `${m}/${d}/${yy}`, `${mm}/${dd}/${yy}`, `${y}-${mm}-${dd}`, `${m}-${d}-${y}`, `${mm}-${dd}-${y}`,
  ];
  return forms.some((form) => {
    for (let at = words.indexOf(form); at >= 0; at = words.indexOf(form, at + 1)) {
      const before = words[at - 1], after = words[at + form.length];
      if (!(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after))) return true;
    }
    return false;
  });
}

// --- one fact ------------------------------------------------------------

function trimmed(value: string | number): string {
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Re-run the value-on-page check and the date check for one fact against a page read now. */
export function auditLiveFact(fact: LiveFact, page: PageRead, now: string, pickedBecause: PickReason = "ROUTINE"): LiveAuditResult {
  const fields = auditableFields(fact.record, fact.sourceUrl);
  const reread = { url: page.url, retrievedAt: page.retrievedAt, contentHash: page.contentHash, artifactId: page.artifactId ?? null };
  const base = { pickedBecause, factId: fact.id, family: fact.family, area: fact.area, checkedAt: now, sourceUrl: fact.sourceUrl, reread, basis: "REREAD" as const };
  if (!page.text.trim()) {
    return { ...base, verdict: "INCONCLUSIVE", checks: [], reason: "The page came back empty, so nothing could be checked." };
  }
  if (!fields.length) {
    return { ...base, verdict: "INCONCLUSIVE", checks: [], reason: "This fact has no value the page should show, so there was nothing to look for." };
  }
  const words = pageWords(page.text);
  const checks: LiveAuditCheck[] = fields.map(({ field, value }) => {
    const date = isoDateParts(value);
    if (date) return { field, kind: "DATE_ON_PAGE" as const, ok: dateOnPage(date, words), value: trimmed(value) };
    return { field, kind: "VALUE_ON_PAGE" as const, ok: valueOnPage(value, page.text, words), value: trimmed(value) };
  });
  const failed = checks.filter((c) => !c.ok);
  if (!failed.length) {
    return { ...base, verdict: "GREEN", checks, reason: `All ${checks.length} value(s) are still on the page.` };
  }
  return { ...base, verdict: "RED", checks,
    reason: `${failed.length} of ${checks.length} value(s) are no longer on the page: ${failed.map((c) => c.field).join(", ")}.` };
}

/** A routine refresh that already re-read this source and found it unchanged since the fact was verified. */
export function greenFromRefresh(fact: LiveFact, refresh: RoutineRefresh | null | undefined, now: string, policy: LiveAuditPolicy, pickedBecause: PickReason = "ROUTINE"): LiveAuditResult | null {
  if (!refresh || !fact.verifiedContentHash || refresh.sourceUrl !== fact.sourceUrl) return null;
  const age = Date.parse(now) - Date.parse(refresh.retrievedAt);
  if (!Number.isFinite(age) || age < 0 || age > policy.refreshMaxAgeHours * 3_600_000) return null;
  if (refresh.contentHash !== fact.verifiedContentHash) return null;
  return { pickedBecause, factId: fact.id, family: fact.family, area: fact.area, verdict: "GREEN", checkedAt: now, sourceUrl: fact.sourceUrl,
    reread: { url: refresh.sourceUrl, retrievedAt: refresh.retrievedAt, contentHash: refresh.contentHash, artifactId: null },
    basis: "UNCHANGED_ROUTINE_REFRESH", checks: [],
    reason: "A routine refresh re-read this page and it is unchanged since the fact was verified." };
}

/**
 * A fact's demand rank from the reader-demand lists (ZIPs, districts, meetings,
 * officials; most-asked first). A fact ranks by the best-placed key it carries: its
 * area, ZIP, division, body, or its own record ID. Null when readers have not asked.
 */
export function demandRanker(lists: readonly (readonly { readonly key: string }[])[]): (fact: LiveFact) => number | null {
  const rank = new Map<string, number>();
  for (const list of lists) list.forEach((row, index) => rank.set(row.key, Math.min(rank.get(row.key) ?? Infinity, index)));
  return (fact) => {
    const keys = [fact.area, fact.record.zip, fact.record.ocdId, fact.record.bodyId, fact.record.id].filter((k): k is string => typeof k === "string");
    const best = Math.min(...keys.map((k) => rank.get(k) ?? Infinity));
    return Number.isFinite(best) ? best : null;
  };
}

// --- the sample ----------------------------------------------------------

/** Stable pseudo-random order: the same pass id gives the same pick, a new pass a new one. */
function order(passId: string, id: string): string {
  return createHash("sha256").update(`${passId}\u0000${id}`).digest("hex");
}

/** The family's freshness class, for the refresh date. */
const FAMILY_CLASS: Readonly<Record<string, string>> = {
  "comment-access": "PUBLIC_COMMENT_RULE", "everyday-routing": "SERVICE_CONTACT", "ballot-navigation": "VOTER_ACCESS_ROUTE",
  "official-filings": "CAMPAIGN_FINANCE_FILING", meetings: "MEETING", rosters: "OFFICIAL_ROSTER",
};
const DEFAULT_WINDOW_HOURS = 7 * 24;

/** The three reasons to look harder at a fact (DP-16), as the sampler reads them. */
export function boostsOf(fact: LiveFact, input: { readonly now: string; readonly demandRank?: number | null }): SampleBoosts {
  const window = FRESHNESS_WINDOW_HOURS[fact.recordClass ?? FAMILY_CLASS[fact.family] ?? ""] ?? DEFAULT_WINDOW_HOURS;
  const verified = fact.verifiedAt ? Date.parse(fact.verifiedAt) : NaN;
  return {
    // Past its refresh date: verified longer ago than twice its window, so the routine refresh has not reached it.
    pastRefresh: Number.isFinite(verified) ? Date.parse(input.now) - verified > 2 * window * 3_600_000 : false,
    singleSource: (fact.sourceCount ?? 1) <= 1,
    demandRank: input.demandRank ?? null,
  };
}

/**
 * Pick facts from one area's pool: not audited recently, oldest-audited first
 * (never-audited before any), ties broken by a hash of the pass so no fact is
 * favoured by its name. Facts past their refresh date or in high demand come
 * first, may be audited again sooner, and the area gets extra slots for them;
 * a single-source fact only wins ties in the order.
 */
export function pickFromArea(pool: readonly LiveFact[], input: {
  readonly passId: string; readonly now: string; readonly policy: LiveAuditPolicy;
  readonly lastAuditedAt: (factId: string) => string | null | undefined;
  readonly demandRankFor?: (fact: LiveFact) => number | null | undefined;
}): { readonly fact: LiveFact; readonly reason: PickReason }[] {
  const { policy } = input;
  const rows = pool.map((fact) => {
    const reason: PickReason = boostReason(boostsOf(fact, { now: input.now, demandRank: input.demandRankFor?.(fact) ?? null })) ?? "ROUTINE";
    return { fact, reason, last: input.lastAuditedAt(fact.id) ?? null };
  }).filter(({ reason, last }) => {
    const hours = reason === "PAST_REFRESH" || reason === "DEMAND" ? policy.boostedMinHoursBetweenAudits : policy.minHoursBetweenAudits;
    return last === null || !(Date.parse(last) > Date.parse(input.now) - hours * 3_600_000);
  });
  const rank = { PAST_REFRESH: 0, DEMAND: 1, SINGLE_SOURCE: 2, ROUTINE: 3 } as const;
  rows.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.last ?? "").localeCompare(b.last ?? "") ||
    order(input.passId, a.fact.id).localeCompare(order(input.passId, b.fact.id)));
  const strong = rows.filter(({ reason }) => reason === "PAST_REFRESH" || reason === "DEMAND").length;
  return rows.slice(0, policy.perAreaPerPass + Math.min(strong, policy.boostExtraPerArea)).map(({ fact, reason }) => ({ fact, reason }));
}

/** Which areas this pass looks at: a rotating window, so every area comes round. */
export function areasForPass(areas: readonly string[], passId: string, policy: LiveAuditPolicy): string[] {
  return [...areas].sort((a, b) => order(passId, a).localeCompare(order(passId, b))).slice(0, policy.areasPerPass);
}

export interface LiveAuditPassDeps {
  readonly catalog: LiveFactCatalog;
  readonly policy?: LiveAuditPolicy;
  readonly now: string;
  /** Names this pass; a new id each pass. */
  readonly passId: string;
  readonly lastAuditedAt: (factId: string) => string | null | undefined;
  /** How much readers ask for this fact's place: 0 is the most; null when they have not. */
  readonly demandRankFor?: (fact: LiveFact) => number | null | undefined;
  /** The routine refresh of a fact's source, when one exists. */
  readonly refreshFor?: (fact: LiveFact) => RoutineRefresh | null | undefined;
  /** Re-read a page through the acquirer toolkit (spaced per host); null when it could not be read. */
  readonly fetchPage: (url: string) => Promise<PageRead | null>;
  /** Where each result goes. A failure to record is the caller's to surface; the pass does not swallow it. */
  readonly record: (result: LiveAuditResult) => Promise<void>;
}

export interface LiveAuditPassSummary {
  readonly areas: number;
  readonly sampled: number;
  readonly green: number;
  readonly red: number;
  readonly inconclusive: number;
  readonly fetches: number;
  readonly fromRefresh: number;
  /** Facts that needed a fetch after the pass had used its fetch allowance. They wait for the next pass. */
  readonly deferred: number;
  /** The sample split by why each fact was picked. */
  readonly byReason: Readonly<Record<PickReason, number>>;
}

/** One live-audit pass: sample by area, prefer a routine refresh, re-read the rest, record green or red. */
export async function runLiveAuditPass(deps: LiveAuditPassDeps): Promise<LiveAuditPassSummary> {
  const policy = deps.policy ?? LIVE_AUDIT_DEFAULT_POLICY;
  const areas = areasForPass(await deps.catalog.areas(), deps.passId, policy);
  const byReason: Record<PickReason, number> = { PAST_REFRESH: 0, DEMAND: 0, SINGLE_SOURCE: 0, ROUTINE: 0 };
  const summary = { areas: areas.length, sampled: 0, green: 0, red: 0, inconclusive: 0, fetches: 0, fromRefresh: 0, deferred: 0, byReason };
  const count = (result: LiveAuditResult) => {
    summary[result.verdict === "GREEN" ? "green" : result.verdict === "RED" ? "red" : "inconclusive"] += 1;
  };
  for (const area of areas) {
    const pool = await deps.catalog.factsInArea(area, policy.poolPerArea);
    for (const { fact, reason } of pickFromArea(pool, { passId: deps.passId, now: deps.now, policy, lastAuditedAt: deps.lastAuditedAt,
      ...(deps.demandRankFor ? { demandRankFor: deps.demandRankFor } : {}) })) {
      summary.sampled += 1;
      byReason[reason] += 1;
      const refreshed = greenFromRefresh(fact, deps.refreshFor?.(fact), deps.now, policy, reason);
      if (refreshed) {
        await deps.record(refreshed);
        summary.fromRefresh += 1;
        count(refreshed);
        continue;
      }
      if (summary.fetches >= policy.maxFetchesPerPass) { summary.deferred += 1; continue; }
      summary.fetches += 1;
      const page = await deps.fetchPage(fact.sourceUrl).catch(() => null);
      const result: LiveAuditResult = page
        ? auditLiveFact(fact, page, deps.now, reason)
        : { pickedBecause: reason, factId: fact.id, family: fact.family, area: fact.area, verdict: "INCONCLUSIVE", checkedAt: deps.now, sourceUrl: fact.sourceUrl,
            reread: null, basis: "NOT_READ", checks: [], reason: "The page could not be read this time; the fact is not called broken." };
      await deps.record(result);
      count(result);
    }
  }
  return summary;
}

// --- a catalog over a curated reader projection ---------------------------

/**
 * Facts from one curated Reader family's published records (comment rules,
 * everyday routing, ballot navigation, campaign sites, venues, member offices,
 * official filings). The area is the record's body, division or ZIP; a record
 * with none is filed under its state, then "national".
 */
export function curatedReaderCatalog(kind: string, records: readonly (Readonly<Record<string, unknown>> & { readonly id: string })[]): LiveFactCatalog {
  const areaOf = (record: Readonly<Record<string, unknown>>): string => {
    for (const key of ["bodyId", "ocdId", "zip", "state"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }
    const nested = record.value as { state?: unknown } | undefined;
    return typeof nested?.state === "string" && nested.state ? nested.state : "national";
  };
  const sourceOf = (record: Readonly<Record<string, unknown>>): string | null => {
    const direct = record.sourceUrl;
    if (typeof direct === "string" && /^https?:\/\//.test(direct)) return direct;
    const contact = record.contact as { sourceUrl?: unknown } | undefined;
    return typeof contact?.sourceUrl === "string" && /^https?:\/\//.test(contact.sourceUrl) ? contact.sourceUrl : null;
  };
  const facts = records.flatMap((record): LiveFact[] => {
    const sourceUrl = sourceOf(record);
    if (!sourceUrl) return [];
    const verified = typeof record.verifiedAt === "string" ? record.verifiedAt : null;
    return [{ id: `${kind}:${record.id}`, family: kind, area: areaOf(record), sourceUrl, record, verifiedAt: verified }];
  });
  const byArea = new Map<string, LiveFact[]>();
  for (const fact of facts) byArea.set(fact.area, [...(byArea.get(fact.area) ?? []), fact]);
  return {
    areas: async () => [...byArea.keys()],
    factsInArea: async (area, limit) => (byArea.get(area) ?? []).slice(0, limit),
  };
}
