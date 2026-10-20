import { PRL_CATEGORIES, PRL_FORBIDDEN_COLUMN_PATTERN, type PrlCategoryKey } from "./types.ts";

/**
 * Per-official numbers precomputed at ingest, so a reader page reads a handful
 * of numbers instead of scanning millions of rows. Federal and state shares are
 * PRL's own means; primary candidates have no profile file, so their shares are
 * aggregated here from PRL's 0/1 labels and attributed as ours. Every share is
 * a percentage 0-100.
 */

/** The five mean columns, derived from the shared category table. */
const MEAN_COLUMNS = PRL_CATEGORIES.map((category) => ({ key: category.key, column: `${category.column}_mean` }));

function assertNoForbidden(columns: readonly string[]): void {
  const bad = columns.filter((column) => PRL_FORBIDDEN_COLUMN_PATTERN.test(column));
  if (bad.length > 0) {
    throw new Error(
      `PRL: refusing to read ${bad.join(", ")} — a rank, percentile or ideology score may not enter a record at any remove.`,
    );
  }
}

function shareFromCell(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

// ---------------------------------------------------------------------------
// State legislator profiles (openstates_id keyed)
// ---------------------------------------------------------------------------

export interface PrlStateProfile {
  /** The join key. OpenStates person id, `ocd-person/<uuid>`. */
  readonly openstatesId: string;
  /** PRL's spelling of the name — for a mismatch check, never rendered. */
  readonly prlName: string;
  readonly state: string;
  /** PRL's party label. Display only; never used to infer a position or vote. */
  readonly party: string;
  /** Legislative chamber: `upper` or `lower`, as PRL's `position`. */
  readonly chamber: string;
  readonly district: string;
  readonly statementCount: number;
  /** Share of statements per category, as PRL computed it (0-100). */
  readonly shares: Record<PrlCategoryKey, number | null>;
  /** State profiles have no source measure date; retrieval is carried separately. */
  readonly measuredAt: string | null;
}

export interface StateProfileResult {
  readonly profiles: PrlStateProfile[];
  readonly counts: {
    readonly rowsInFile: number;
    readonly rowsWithStatements: number;
    readonly matched: number;
    readonly droppedNoStatements: number;
    readonly droppedNoIdentity: number;
  };
}
const OPENSTATES_ID = /^ocd-person\/[0-9a-f-]{36}$/;

/**
 * Read the state profiles CSV into openstates-keyed records with a positive
 * statement count. Ranks are refused by the allowlist; only the five means and
 * the count cross.
 */
export function normalizeStateProfiles(rows: readonly (readonly string[])[], measuredAt: string | null): StateProfileResult {
  if (rows.length === 0) throw new Error("PRL: the state profiles file parsed to zero rows");
  const header = rows[0];
  const wanted = ["openstates_id", "name", "state", "party", "position", "district", "communication_count", ...MEAN_COLUMNS.map((m) => m.column)];
  assertNoForbidden(wanted);
  const at = new Map(header.map((name, index) => [name, index]));
  for (const column of wanted) {
    if (!at.has(column)) {
      throw new Error(`PRL: the state profiles file has no column "${column}" — the schema moved, and guessing which replaced it ships a wrong number.`);
    }
  }

  const profiles: PrlStateProfile[] = [];
  const seen = new Set<string>();
  let rowsWithStatements = 0;
  let droppedNoStatements = 0;
  let droppedNoIdentity = 0;
  const data = rows.slice(1).filter((row) => row.length > 1);

  for (const row of data) {
    const openstatesId = (row[at.get("openstates_id")!] ?? "").trim();
    const count = Number(row[at.get("communication_count")!]);
    if (Number.isFinite(count) && count > 0) rowsWithStatements += 1;
    if (!OPENSTATES_ID.test(openstatesId)) {
      droppedNoIdentity += 1;
      continue;
    }
    if (!Number.isFinite(count) || count <= 0) {
      droppedNoStatements += 1;
      continue;
    }
    if (seen.has(openstatesId)) continue;
    const shares = {} as Record<PrlCategoryKey, number | null>;
    for (const mean of MEAN_COLUMNS) shares[mean.key] = shareFromCell(row[at.get(mean.column)!]);
    profiles.push({
      openstatesId,
      prlName: (row[at.get("name")!] ?? "").trim(),
      state: (row[at.get("state")!] ?? "").trim(),
      party: (row[at.get("party")!] ?? "").trim(),
      chamber: (row[at.get("position")!] ?? "").trim(),
      district: (row[at.get("district")!] ?? "").trim(),
      statementCount: Math.round(count),
      shares,
      measuredAt,
    });
    seen.add(openstatesId);
  }

  return {
    profiles: profiles.sort((a, b) => a.openstatesId.localeCompare(b.openstatesId)),
    counts: { rowsInFile: data.length, rowsWithStatements, matched: profiles.length, droppedNoStatements, droppedNoIdentity },
  };
}

// ---------------------------------------------------------------------------
// Primary candidate rhetoric (FEC candidate_id keyed) — aggregated by us
// ---------------------------------------------------------------------------

export interface PrlPrimaryProfile {
  /** The join key. FEC candidate id. */
  readonly candidateId: string;
  readonly prlName: string;
  readonly party: string;
  readonly state: string;
  readonly office: string;
  readonly district: string;
  /** C = challenger, I = incumbent, O = open seat. */
  readonly incumbentChallenge: string;
  readonly statementCount: number;
  /**
   * Share of classified tweets per category, 0-100. **Computed here** by
   * aggregating PRL's own 0/1 labels — there is no primary profile file — so
   * the number is ours over PRL's classifications, and is attributed that way.
   */
  readonly shares: Record<PrlCategoryKey, number | null>;
  readonly measuredAt: string;
}

const FEC_CANDIDATE_ID = /^[HSP][0-9A-Z]{8}$/;

/** The 0/1 flag column that backs each category share, at the row level. */
const FLAG_FOR_CATEGORY: Record<PrlCategoryKey, string> = {
  policy: "policy",
  bipartisanship: "outcome_bipartisanship",
  creditclaiming: "outcome_creditclaiming",
  "attack-policy": "attack_policy",
  "attack-personal": "attack_personal",
};

interface PrimaryAccumulator {
  name: string;
  party: string;
  state: string;
  office: string;
  district: string;
  incumbentChallenge: string;
  count: number;
  sums: Record<PrlCategoryKey, number>;
}

export interface PrimaryAggregateResult {
  readonly profiles: PrlPrimaryProfile[];
  readonly counts: {
    readonly rowsSeen: number;
    readonly rowsClassified: number;
    readonly candidates: number;
    readonly droppedNoIdentity: number;
  };
}

export interface PrimaryAggregator {
  /** Feed one parsed primary CSV record. */
  add(record: Record<string, string>): void;
  /** Finish and produce the per-candidate profiles. */
  result(measuredAt: string): PrimaryAggregateResult;
}

/**
 * One native candidate's running totals. The disk index feeds each candidate separately.
 */
export function createPrimaryAggregator(subject: string): PrimaryAggregator {
  let accumulator: PrimaryAccumulator | null = null;
  let rowsSeen = 0;
  let rowsClassified = 0;
  let droppedNoIdentity = 0;
  return {
    add(record: Record<string, string>): void {
      rowsSeen += 1;
      const candidateId = (record["candidate_id"] ?? "").trim();
      if (!FEC_CANDIDATE_ID.test(candidateId)) {
        droppedNoIdentity += 1;
        return;
      }
      if (candidateId !== subject) throw new Error("PRL_PRIMARY_AGGREGATION_CROSSES_NATIVE_PERSON");
      // Every row present in this tweets file is a classified tweet.
      rowsClassified += 1;
      let acc = accumulator;
      if (!acc) {
        acc = {
          name: (record["name"] ?? "").trim(),
          party: (record["party"] ?? "").trim(),
          state: (record["state"] ?? "").trim(),
          office: (record["office_full"] ?? "").trim(),
          district: (record["district"] ?? "").trim(),
          incumbentChallenge: (record["incumbent_challenge"] ?? "").trim(),
          count: 0,
          sums: { policy: 0, bipartisanship: 0, creditclaiming: 0, "attack-policy": 0, "attack-personal": 0 },
        };
        accumulator = acc;
      }
      acc.count += 1;
      for (const category of PRL_CATEGORIES) {
        if ((record[FLAG_FOR_CATEGORY[category.key]] ?? "").trim() === "1") acc.sums[category.key] += 1;
      }
    },
    result(measuredAt: string): PrimaryAggregateResult {
      const profiles: PrlPrimaryProfile[] = accumulator === null ? [] : [accumulator].map(acc => {
        const shares = {} as Record<PrlCategoryKey, number | null>;
        for (const category of PRL_CATEGORIES) {
          // A percentage of classified tweets, rounded to two decimals like PRL's own means.
          shares[category.key] = acc.count > 0 ? Math.round((acc.sums[category.key] / acc.count) * 10000) / 100 : null;
        }
        return {
          candidateId: subject,
          prlName: acc.name,
          party: acc.party,
          state: acc.state,
          office: acc.office,
          district: acc.district,
          incumbentChallenge: acc.incumbentChallenge,
          statementCount: acc.count,
          shares,
          measuredAt,
        };
      }).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
      return { profiles, counts: { rowsSeen, rowsClassified, candidates: profiles.length, droppedNoIdentity } };
    },
  };
}
