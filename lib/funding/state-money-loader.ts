import { createHash } from "node:crypto";
import type { DoorInput, DoorOutcome } from "../core/door.ts";
import type { SavedCopy } from "../facts/check.ts";
import type { Query } from "../facts/publish.ts";
import {
  campaignClaims, moneyDoorInput,
  type CampaignPeriodRecord, type FilerIdentity, type FilingPeriod, type FiledAmount, type NamedLine,
} from "./money-records.ts";
import { isSmallDonorTotal } from "./small-donors.ts";

/**
 * The one loader every state's campaign money goes through. A state lane
 * implements `parse` (one saved filing in, typed lines out) and supplies the
 * list of its saved filings. Everything else is here: each filing is read once
 * by its fingerprint, donors are grouped per cycle, donors giving $200 or less
 * in the cycle are folded into a count and a sum before anything leaves this
 * file, spending lines are never counted as contributions, and the money is
 * filed to the seat's holder through the one person matcher.
 */

/** Per period, per kind, how many named lines a record carries, and how many filing lines one named party may show. */
export const MAX_NAMED_PER_KIND = 10;
export const MAX_LINES_PER_PARTY = 50;

/** One line of a filing. The parser marks which way the money moved; the loader counts only receipts. */
export interface FilingLine {
  readonly flow: "receipt" | "expenditure";
  /** The state's own id for this transaction; a repeat of the id in another filing is the same transaction. */
  readonly id: string;
  /** Who gave (receipt) or was paid (expenditure). `key` is stable for one donor across filings. */
  readonly party: { readonly key: string; readonly name: string; readonly kind: "individual" | "organization" };
  readonly amount: FiledAmount;
}

export interface ParsedFiling {
  readonly filer: FilerIdentity;
  readonly period: FilingPeriod;
  readonly filingUrl: string;
  readonly publisher: string;
  /** Only totals the filing states, each with its line. This period's amount, never a running total. */
  readonly summary: {
    readonly raised: FiledAmount | null;
    readonly spent: FiledAmount | null;
    readonly individual: FiledAmount | null;
    readonly individualSmall: FiledAmount | null;
  };
  readonly lines: readonly FilingLine[];
}

/** The saved copy of a filing and the parse of it. */
export interface LoadedFiling { readonly copy: SavedCopy; readonly filing: ParsedFiling }

export interface BuiltMoney {
  readonly records: readonly (CampaignPeriodRecord & { readonly copy: SavedCopy })[];
  /** What donors giving $200 or less in the cycle added up to, with no names. */
  readonly smallIndividuals: { readonly amount: number; readonly donors: number };
  readonly spendingLinesIgnored: number;
  /** Things the filing did not let us publish, with the reason. */
  readonly blanks: readonly { readonly periodKey: string; readonly what: string; readonly reason: string }[];
}

const dollars = (amount: number) => Math.round(amount * 100);

/** Pure: parsed filings of one filer and cycle in, period records out. */
export function buildPeriodRecords(loaded: readonly LoadedFiling[]): BuiltMoney {
  // An amended filing replaces the earlier filing of the same period.
  const latest = new Map<string, LoadedFiling>();
  for (const item of loaded) {
    const key = item.filing.period.key, held = latest.get(key);
    if (!held || item.copy.fetchedAt >= held.copy.fetchedAt) latest.set(key, item);
  }
  const filings = [...latest.values()].sort((a, b) => (a.filing.period.to ?? a.filing.period.key).localeCompare(b.filing.period.to ?? b.filing.period.key));
  // One transaction is counted once, in the earliest period that lists it.
  const seen = new Set<string>();
  const receipts = filings.map(item => ({ item, lines: item.filing.lines.filter(line => {
    if (line.flow !== "receipt" || seen.has(line.id)) return false;
    seen.add(line.id);
    return true;
  }) }));
  const spendingLinesIgnored = filings.reduce((n, item) => n + item.filing.lines.filter(line => line.flow === "expenditure").length, 0);

  const cycleCents = new Map<string, number>();
  for (const { lines } of receipts) for (const line of lines)
    if (line.party.kind === "individual") cycleCents.set(line.party.key, (cycleCents.get(line.party.key) ?? 0) + dollars(line.amount.amount));
  const small = [...cycleCents.values()].filter(total => total > 0 && isSmallDonorTotal(total / 100));
  const smallIndividuals = { amount: small.reduce((n, total) => n + total, 0) / 100, donors: small.length };
  const named = (line: FilingLine) => line.party.kind === "organization" || !isSmallDonorTotal((cycleCents.get(line.party.key) ?? 0) / 100);

  const blanks: { periodKey: string; what: string; reason: string }[] = [];
  const records = receipts.map(({ item, lines }) => {
    const { filing, copy } = item;
    const byParty = new Map<string, FilingLine[]>();
    for (const line of lines) if (named(line) && dollars(line.amount.amount) > 0) byParty.set(line.party.key, [...byParty.get(line.party.key) ?? [], line]);
    const ranked = [...byParty.values()].map(group => ({ group, total: group.reduce((n, line) => n + dollars(line.amount.amount), 0) }))
      .sort((a, b) => b.total - a.total || a.group[0].party.key.localeCompare(b.group[0].party.key));
    const take = (kind: NamedLine["kind"]): NamedLine[] => ranked.filter(row => row.group[0].party.kind === kind).slice(0, MAX_NAMED_PER_KIND).flatMap(row => {
      if (row.group.length > MAX_LINES_PER_PARTY) {
        blanks.push({ periodKey: filing.period.key, what: "named giver", reason: "TOO_MANY_LINES_FOR_ONE_GIVER" });
        return [];
      }
      return row.group.map(line => ({ partyKey: line.party.key, name: line.party.name, kind, lineId: line.id, amount: line.amount }));
    });
    for (const [what, filed] of [["raised", filing.summary.raised], ["spent", filing.summary.spent]] as const)
      if (!filed) blanks.push({ periodKey: filing.period.key, what, reason: "FILING_STATES_NO_TOTAL" });
    return { filer: filing.filer, period: filing.period, filingUrl: filing.filingUrl, publisher: filing.publisher, ...filing.summary,
      donors: take("individual"), committees: take("organization"), copy };
  });
  return { records, smallIndividuals, spendingLinesIgnored, blanks };
}

/** Builder A's one person matcher, injected. A tie goes to a detective; the loader never picks. */
export type HolderMatch =
  | { readonly status: "matched"; readonly subjectId: string }
  | { readonly status: "tie"; readonly candidates: readonly string[] }
  | { readonly status: "none"; readonly reason: string };
export type HolderMatcher = (filer: FilerIdentity, cycle: number) => Promise<HolderMatch>;

export interface DetectiveCase { readonly id: string; readonly reason: "HOLDER_TIE"; readonly filer: FilerIdentity; readonly cycle: number; readonly candidates: readonly string[] }

/** A saved filing, listed without reading it. */
export interface FilingRef {
  /** The saved bytes' fingerprint. */
  readonly fingerprint: string;
  readonly filerId: string;
  readonly cycle: number;
  readonly load: () => Promise<SavedCopy>;
}

/** Where the loader remembers which set of filings it has already turned into facts. */
export interface FilingCursor {
  read(keys: readonly string[]): Promise<ReadonlyMap<string, string>>;
  write(entries: readonly (readonly [string, string])[]): Promise<void>;
}

export function passFilingCursor(query: Query, state: string): FilingCursor {
  const name = (key: string) => `money-filings:${state}:${key}`;
  return {
    async read(keys) {
      if (!keys.length) return new Map();
      const rows = await query("SELECT name,position FROM pass_cursor WHERE name=ANY($1::text[])", [keys.map(name)]);
      return new Map(rows.map(row => [String(row.name).slice(name("").length), String(row.position)]));
    },
    async write(entries) {
      if (!entries.length) return;
      await query(`INSERT INTO pass_cursor(name,position) SELECT e.name,e.position FROM unnest($1::text[],$2::text[]) e(name,position)
        ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position WHERE pass_cursor.position IS DISTINCT FROM EXCLUDED.position`,
      [entries.map(([key]) => name(key)), entries.map(([, fingerprint]) => fingerprint)]);
    },
  };
}

export interface StateMoneyOptions {
  readonly state: string;
  readonly filings: readonly FilingRef[];
  /** The lane's one hook: a saved filing in, what it states out. No database, no network. */
  readonly parse: (copy: SavedCopy) => readonly ParsedFiling[];
  /** Changes whenever the lane's parser does, so its filings are read again. */
  readonly parserVersion: string;
  readonly cursor: FilingCursor;
  readonly match: HolderMatcher;
  /** The Slide. */
  readonly publish: (input: DoorInput) => Promise<DoorOutcome>;
  readonly detective: (item: DetectiveCase) => Promise<void>;
}

export interface StateMoneySummary {
  readonly groups: number;
  readonly unchanged: number;
  readonly loaded: number;
  readonly published: number;
  readonly confirmed: number;
  readonly refused: readonly { readonly field: string; readonly reason: string }[];
  readonly unmatched: number;
  readonly ties: number;
  readonly smallIndividuals: { readonly amount: number; readonly donors: number };
  readonly spendingLinesIgnored: number;
  readonly blanks: BuiltMoney["blanks"];
}

const bundleFingerprint = (refs: readonly FilingRef[], parserVersion: string) =>
  createHash("sha256").update([parserVersion, ...refs.map(ref => ref.fingerprint).sort()].join("\n")).digest("hex");

export async function loadStateMoney(options: StateMoneyOptions): Promise<StateMoneySummary> {
  const groups = new Map<string, FilingRef[]>();
  for (const ref of options.filings) groups.set(`${ref.filerId}|${ref.cycle}`, [...groups.get(`${ref.filerId}|${ref.cycle}`) ?? [], ref]);
  const held = await options.cursor.read([...groups.keys()]);
  const total = { unchanged: 0, loaded: 0, published: 0, confirmed: 0, unmatched: 0, ties: 0, spendingLinesIgnored: 0,
    smallIndividuals: { amount: 0, donors: 0 }, refused: [] as { field: string; reason: string }[], blanks: [] as BuiltMoney["blanks"][number][] };
  const done: (readonly [string, string])[] = [];
  for (const [key, refs] of groups) {
    const fingerprint = bundleFingerprint(refs, options.parserVersion);
    if (held.get(key) === fingerprint) { total.unchanged++; continue; }
    const loaded: LoadedFiling[] = [];
    for (const ref of refs) {
      const copy = await ref.load();
      for (const filing of options.parse(copy)) loaded.push({ copy, filing });
    }
    total.loaded++;
    const built = buildPeriodRecords(loaded);
    total.spendingLinesIgnored += built.spendingLinesIgnored;
    total.smallIndividuals.amount += built.smallIndividuals.amount;
    total.smallIndividuals.donors += built.smallIndividuals.donors;
    total.blanks.push(...built.blanks);
    let clean = true;
    const matches = new Map<string, HolderMatch>();
    for (const record of built.records) {
      const id = `${record.filer.id}|${record.period.cycle}`;
      let match = matches.get(id);
      if (!match) {
        matches.set(id, match = await options.match(record.filer, record.period.cycle));
        if (match.status === "tie") {
          total.ties++;
          await options.detective({ id: `money-holder:${options.state}:${record.filer.id}:${record.period.cycle}`, reason: "HOLDER_TIE",
            filer: record.filer, cycle: record.period.cycle, candidates: match.candidates });
        } else if (match.status === "none") total.unmatched++;
      }
      if (match.status !== "matched") { clean = false; continue; }
      for (const claim of campaignClaims(match.subjectId, record)) {
        const outcome = await options.publish(moneyDoorInput(claim, record.copy, `money:${options.state}`));
        if ("refused" in outcome) { total.refused.push({ field: claim.field, reason: outcome.refused }); clean = false; }
        else if (outcome.decision === "PUBLISH") total.published++;
        else if (outcome.decision === "CONFIRM") total.confirmed++;
      }
    }
    if (clean) done.push([key, fingerprint]);
  }
  await options.cursor.write(done);
  return { groups: groups.size, ...total };
}
