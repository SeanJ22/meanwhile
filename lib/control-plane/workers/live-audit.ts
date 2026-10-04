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
import { pageWords, valueOnPage, SECTION3_LABEL_FIELDS } from "../promotion/section3.ts";

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
}

export const LIVE_AUDIT_DEFAULT_POLICY: LiveAuditPolicy = {
  perAreaPerPass: 1,
  areasPerPass: 40,
  minHoursBetweenAudits: 7 * 24,
  poolPerArea: 50,
  refreshMaxAgeHours: 36,
  maxFetchesPerPass: 60,
};

export type LiveAuditVerdict = "GREEN" | "RED" | "INCONCLUSIVE";

export interface LiveAuditCheck {
  readonly field: string;
  readonly kind: "VALUE_ON_PAGE" | "DATE_ON_PAGE";
  readonly ok: boolean;
  /** What the record says, trimmed for the result. */
  readonly value: string;
}

export interface LiveAuditResult {
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
export function auditLiveFact(fact: LiveFact, page: PageRead, now: string): LiveAuditResult {
  const fields = auditableFields(fact.record, fact.sourceUrl);
  const reread = { url: page.url, retrievedAt: page.retrievedAt, contentHash: page.contentHash, artifactId: page.artifactId ?? null };
  const base = { factId: fact.id, family: fact.family, area: fact.area, checkedAt: now, sourceUrl: fact.sourceUrl, reread, basis: "REREAD" as const };
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
export function greenFromRefresh(fact: LiveFact, refresh: RoutineRefresh | null | undefined, now: string, policy: LiveAuditPolicy): LiveAuditResult | null {
  if (!refresh || !fact.verifiedContentHash || refresh.sourceUrl !== fact.sourceUrl) return null;
  const age = Date.parse(now) - Date.parse(refresh.retrievedAt);
  if (!Number.isFinite(age) || age < 0 || age > policy.refreshMaxAgeHours * 3_600_000) return null;
  if (refresh.contentHash !== fact.verifiedContentHash) return null;
  return { factId: fact.id, family: fact.family, area: fact.area, verdict: "GREEN", checkedAt: now, sourceUrl: fact.sourceUrl,
    reread: { url: refresh.sourceUrl, retrievedAt: refresh.retrievedAt, contentHash: refresh.contentHash, artifactId: null },
    basis: "UNCHANGED_ROUTINE_REFRESH", checks: [],
    reason: "A routine refresh re-read this page and it is unchanged since the fact was verified." };
}

// --- the sample ----------------------------------------------------------

/** Stable pseudo-random order: the same pass id gives the same pick, a new pass a new one. */
function order(passId: string, id: string): string {
  return createHash("sha256").update(`${passId}\u0000${id}`).digest("hex");
}

/**
 * Pick facts from one area's pool: not audited recently, oldest-audited first
 * (never-audited before any), ties broken by a hash of the pass so no fact is
 * favoured by its name.
 */
export function pickFromArea(pool: readonly LiveFact[], input: {
  readonly passId: string; readonly now: string; readonly policy: LiveAuditPolicy;
  readonly lastAuditedAt: (factId: string) => string | null | undefined;
}): LiveFact[] {
  const cutoff = Date.parse(input.now) - input.policy.minHoursBetweenAudits * 3_600_000;
  return pool
    .map((fact) => ({ fact, last: input.lastAuditedAt(fact.id) ?? null }))
    .filter(({ last }) => last === null || !(Date.parse(last) > cutoff))
    .sort((a, b) => (a.last ?? "").localeCompare(b.last ?? "") || order(input.passId, a.fact.id).localeCompare(order(input.passId, b.fact.id)))
    .slice(0, input.policy.perAreaPerPass)
    .map(({ fact }) => fact);
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
}

/** One live-audit pass: sample by area, prefer a routine refresh, re-read the rest, record green or red. */
export async function runLiveAuditPass(deps: LiveAuditPassDeps): Promise<LiveAuditPassSummary> {
  const policy = deps.policy ?? LIVE_AUDIT_DEFAULT_POLICY;
  const areas = areasForPass(await deps.catalog.areas(), deps.passId, policy);
  const summary = { areas: areas.length, sampled: 0, green: 0, red: 0, inconclusive: 0, fetches: 0, fromRefresh: 0, deferred: 0 };
  const count = (result: LiveAuditResult) => {
    summary[result.verdict === "GREEN" ? "green" : result.verdict === "RED" ? "red" : "inconclusive"] += 1;
  };
  for (const area of areas) {
    const pool = await deps.catalog.factsInArea(area, policy.poolPerArea);
    for (const fact of pickFromArea(pool, { passId: deps.passId, now: deps.now, policy, lastAuditedAt: deps.lastAuditedAt })) {
      summary.sampled += 1;
      const refreshed = greenFromRefresh(fact, deps.refreshFor?.(fact), deps.now, policy);
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
        ? auditLiveFact(fact, page, deps.now)
        : { factId: fact.id, family: fact.family, area: fact.area, verdict: "INCONCLUSIVE", checkedAt: deps.now, sourceUrl: fact.sourceUrl,
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
