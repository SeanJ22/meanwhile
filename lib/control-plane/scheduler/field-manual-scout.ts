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
  readonly recordClass?: string | null;
  readonly limit?: number;
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

/**
 * Project a scout's read down to its page, ranked for its place and record
 * class. Capped so a walk inherits a cache-cheap page of the most useful
 * doors, never the whole manual.
 */
export function scoutFieldManualProjection(
  read: Pick<FieldManualRead, "store" | "evidence">,
  opts: ScoutManualOptions,
): FieldManualProjection {
  const store = read.store;
  // Rank applicable field hints first; cross-family methods keep the remaining slots.
  const related: Readonly<Record<string, readonly string[]>> = {
    OFFICIAL_ROSTER: ["officeholder", "roster", "contact", "verifiedpage", "photo", "body", "officials"],
    OFFICIAL_BOARD_DIRECTORY: ["body", "jurisdiction", "roster", "verifiedpage"],
    PUBLIC_COMMENT_RULE: ["meeting", "agenda", "minutes", "body", "verifiedpage"],
    CANDIDATE_FILING_DOCUMENT: ["candidate", "contest", "filing", "document"],
    CAMPAIGN_FINANCE_FILING: ["filing", "document", "contribution", "expenditure"],
  };
  const hints = new Set([opts.recordClass?.toLowerCase() ?? "", ...(related[opts.recordClass ?? ""] ?? [])]);
  const full = projectFieldManual(store, { ...scoutFieldManualQuery(opts), limit: store.entries.length }, read.evidence);
  const byId = new Map(store.entries.map(entry => [entry.id, entry] as const));
  const indexed = full.entryIds.map((id, index) => ({ id, line: full.lines[index]!, tier: full.tiers[index]!, entry: byId.get(id)! }))
    .filter(row => row.entry.kind !== "PLAYBOOK" && (row.entry.kind !== "EXHAUSTED_RUNGS" || !opts.recordClass || row.entry.recordClasses.includes(opts.recordClass.toLowerCase())));
  // Within each rank, the record class's own fields first.
  const affinity = (entry: FieldManualEntry) => entry.recordClasses.some(value => hints.has(value.toLowerCase())) ? 0 : entry.recordClasses.length === 0 ? 1 : 2;
  indexed.sort((a, b) => a.tier - b.tier || affinity(a.entry) - affinity(b.entry));
  const chosen = indexed.slice(0, opts.limit ?? 30);
  return { lines: chosen.map(row => row.line), entryIds: chosen.map(row => row.id), tiers: chosen.map(row => row.tier),
    leftOutFailingHere: full.leftOutFailingHere, matched: full.matched, total: full.total };
}
