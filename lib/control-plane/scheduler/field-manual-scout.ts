import {
  projectFieldManual,
  type FieldManualEntry,
  type FieldManualProjection,
  type FieldManualQuery,
  type FieldManualRead,
} from "../field-manual.ts";

const STATE_TOKEN = /\b(az|nh|nj|a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])\b/i;
const OCD_STATE = /state:([a-z]{2})/i;

/** The two-letter state(s) an obligation is about, from its OCD subject or its id. Empty = jurisdiction-agnostic. */
export function scoutStateHint(subjectId: string | null | undefined, obligationId: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const value of [subjectId, obligationId]) {
    if (!value) continue;
    const ocd = OCD_STATE.exec(value) ?? /^([a-z]{2}):/i.exec(value);
    if (ocd) out.add(ocd[1]!.toLowerCase());
    const tok = STATE_TOKEN.exec(value.replace(/^[a-z]+:/i, ""));
    if (tok) out.add(tok[1]!.toLowerCase());
  }
  return [...out];
}

export interface ScoutManualOptions {
  /** The place the walk is for: its division, or a state code. */
  readonly subjectId?: string | null;
  readonly obligationId?: string | null;
  /** The divisions the walk's obligation covers. */
  readonly divisions?: readonly string[];
  /** The record classes of the blanks the walk is for; notes on them rank first. */
  readonly recordClasses?: readonly string[];
  readonly limit?: number;
}

/** The field manual's record class for each checklist family's blanks. */
const FAMILY_RECORD_CLASS: Readonly<Record<string, string>> = {
  GOV: "local-jurisdiction", OFF: "official_roster", MTG: "meetings", DOC: "meetings", PAR: "public_comment_rule",
  ELE: "ballot_contest", CAN: "candidate-enrichment", CAM: "campaign_finance_filing",
};

/** The note classes that also bear on each record class. */
const RELATED: Readonly<Record<string, readonly string[]>> = {
  "local-jurisdiction": ["official_board_directory", "body", "jurisdiction", "roster", "verifiedpage"],
  official_roster: ["officeholder", "official", "roster", "contact", "email", "photo", "verifiedpage"],
  meetings: ["meetings-discovery", "meeting", "agenda", "minutes", "packet", "document", "outcome", "vote", "official_document_sitemap"],
  public_comment_rule: ["service_contact", "meeting", "agenda", "contact"],
  ballot_contest: ["voter_access_route", "election", "contest", "ballot", "measure", "voting_site"],
  "candidate-enrichment": ["candidate_filing_document", "candidate", "candidacy", "campaignsite", "contact", "photo", "blurb", "filing"],
  campaign_finance_filing: ["campaign_finance_document", "filing", "document", "contribution", "expenditure"],
};

/** The record class of a blank, by its checklist id; null for a field that is not a checklist item. */
export function blankRecordClass(checklistId: string): string | null {
  const family = /^([A-Z]+)-\d+$/.exec(checklistId)?.[1];
  return family === undefined ? null : FAMILY_RECORD_CLASS[family] ?? family.toLowerCase();
}

/** The walk's own places: its subject when that is a division, and the divisions its obligation covers. */
function scoutPlaces(subjectId: string | null | undefined, divisions: readonly string[] = []): string[] {
  const subject = subjectId?.split("#")[0];
  return [...new Set([...(subject?.startsWith("ocd-division/") ? [subject] : []), ...divisions.filter((d) => d.startsWith("ocd-division/"))])];
}

/** The read a scout's page is cut from: its role, its place and its state. */
export function scoutFieldManualQuery(opts: ScoutManualOptions): FieldManualQuery {
  const states = scoutStateHint(opts.subjectId, opts.obligationId);
  const places = scoutPlaces(opts.subjectId, opts.divisions);
  return {
    role: "SCOUT", subjectId: opts.subjectId ?? undefined,
    ...(states[0] ? { state: states[0] } : {}),
    ...(places.length > 0 ? { ocdIds: places } : {}),
  };
}

/** A scout's page of the manual, ranked for its place and record class and capped,
 * so a walk inherits the most useful doors, never the whole manual. */
export function scoutFieldManualProjection(
  read: Pick<FieldManualRead, "store" | "evidence">,
  opts: ScoutManualOptions,
): FieldManualProjection {
  const store = read.store;
  const classes = new Set((opts.recordClasses ?? []).map(value => value.toLowerCase()));
  const hints = new Set([...classes].flatMap(value => [value, ...(RELATED[value] ?? [])]));
  const full = projectFieldManual(store, { ...scoutFieldManualQuery(opts), limit: store.entries.length }, read.evidence);
  const byId = new Map(store.entries.map(entry => [entry.id, entry] as const));
  const indexed = full.entryIds.map((id, index) => ({ id, line: full.lines[index]!, tier: full.tiers[index]!, entry: byId.get(id)! }))
    .filter(row => row.entry.kind !== "PLAYBOOK" && (row.entry.kind !== "EXHAUSTED_RUNGS" || classes.size === 0 || row.entry.recordClasses.some(value => classes.has(value))));
  // Notes on the blanks' own record classes first; then by rank, notes for any class ahead of other classes.
  const helps = (entry: FieldManualEntry) => entry.recordClasses.some(value => hints.has(value.toLowerCase())) ? 0 : 1;
  const anyClass = (entry: FieldManualEntry) => entry.recordClasses.length === 0 ? 0 : 1;
  indexed.sort((a, b) => helps(a.entry) - helps(b.entry) || a.tier - b.tier || anyClass(a.entry) - anyClass(b.entry));
  const chosen = indexed.slice(0, opts.limit ?? 30);
  return { lines: chosen.map(row => row.line), entryIds: chosen.map(row => row.id), tiers: chosen.map(row => row.tier),
    leftOutFailingHere: full.leftOutFailingHere, matched: full.matched, total: full.total };
}
