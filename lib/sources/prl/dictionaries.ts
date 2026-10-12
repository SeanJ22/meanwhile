import { PRL_FORBIDDEN_COLUMN_PATTERN } from "./types.ts";

/**
 * What each PRL dictionary says its fields mean. Encodes only what ingestion
 * depends on — the identity key, the incremental cursor, the publication date
 * and the five classification flags — plus a column-presence check so a moved
 * schema stops the run instead of shipping a guess.
 */

/**
 * The five things PRL's model labels a statement as, at the ROW level. These
 * are the raw per-statement flags (0/1). The aggregate profile files carry the
 * same five as `communication_<flag>_mean` shares — see {@link PRL_CATEGORIES}
 * in `types.ts`, which is the profile-column form of this same list.
 *
 * `policy_area`, `attack_target`, `extreme_target` and the `*_explanation`
 * columns are the model's own reasoning and targets; they are stored in the raw
 * archive but never projected to a Reader, because "attacking a person" is a
 * measurement we keep and "who was attacked" is a name we never render.
 */
export const PRL_CLASSIFICATION_FLAGS = [
  { column: "policy", label: "about policy", meaning: "The text discusses a policy question rather than a person or party." },
  { column: "attack_personal", label: "attacking a person", meaning: "The text leverages a personal attack on someone's character or reputation." },
  { column: "attack_policy", label: "attacking a policy", meaning: "The text criticises a policy or position rather than a person." },
  { column: "outcome_bipartisanship", label: "working across parties", meaning: "The text mentions bipartisanship or working across the aisle." },
  { column: "outcome_creditclaiming", label: "claiming credit", meaning: "The text takes credit for an accomplishment." },
] as const;

export type PrlDictionaryId =
  | "dict-communication"
  | "dict-profiles"
  | "dict-primary"
  | "dict-state-rhetoric"
  | "dict-state-profiles";

export interface PrlColumnContract {
  /** The dataset file this dictionary describes. */
  readonly describes: string;
  /** The identity column that keys a row to an official. */
  readonly key: string | null;
  /** The incremental cursor column (the revise-vs-append finding, per file). */
  readonly cursor: string | null;
  /** The publication-date column, for the display-time future-date rule. */
  readonly date: string | null;
  /** A stable per-row id, where the file carries one. */
  readonly rowId: string | null;
  /** Columns the ingestion reads and therefore requires to exist. */
  readonly required: readonly string[];
  /** One-line summary of the dictionary, for the report. */
  readonly summary: string;
}

const FLAG_COLUMNS = PRL_CLASSIFICATION_FLAGS.map((flag) => flag.column);

/**
 * The per-dictionary column contract. `required` is what a run reads; if the
 * committed dictionary loses one of these, `assertDictionaryColumns` throws.
 */
export const PRL_DICTIONARY_CONTRACTS: Record<PrlDictionaryId, PrlColumnContract> = {
  "dict-communication": {
    describes: "rhetoric-all.zip / rhetoric-all-national.zip",
    key: "bioguide_id",
    cursor: "last_updated",
    date: "date",
    rowId: "source_id",
    required: ["source", "source_id", "bioguide_id", "text", "date", "last_updated", "classified", ...FLAG_COLUMNS],
    summary:
      "Federal classified statements. One row per classified text snippet across floor speeches, newsletters, press releases and tweets. `bioguide_id` keys the member; `source`+`source_id` identify the original entry; `date` is publication, `last_updated` is the classification timestamp (proves reclassification). Five 0/1 flags plus the model's `*_explanation`, `attack_target` and `policy_area` reasoning.",
  },
  "dict-profiles": {
    describes: "profiles.zip / profiles-all-national.zip",
    key: "bioguide_id",
    cursor: null,
    date: "communication_last_update",
    rowId: "bioguide_id",
    // `full_name` is read from the data file but the dictionary does not
    // document it, so it is not asserted here — only documented columns whose
    // meaning the ingestion relies on are.
    required: ["bioguide_id", "communication_count", "communication_source", "communication_last_update"],
    summary:
      "Federal aggregate profiles, one row per member (51 columns). Carries the five `communication_<flag>_mean` shares (0-100) and `communication_count` we keep, alongside ideology score, ideology/money ranks and percentiles, and a ProPublica JSON blob (icpsr, fec_candidate_id, dw_nominate) — the ranks/percentiles/ideology are refused by the allowlist and never enter a record.",
  },
  "dict-primary": {
    describes: "primary-rhetoric.zip",
    key: "candidate_id",
    cursor: "date",
    date: "date",
    rowId: "tweet_id",
    required: ["candidate_id", "source", "text", "date", "tweet_id", ...FLAG_COLUMNS],
    summary:
      "2026 primary candidate rhetoric, one row per classified tweet. `candidate_id` is the FEC candidate id (the join key for challengers with no bioguide); `tweet_id` is the stable row id; `incumbent_challenge` marks C/I/O. Five 0/1 flags. No modification stamp — appends, keyed by `tweet_id`.",
  },
  "dict-state-rhetoric": {
    describes: "state-rhetoric-all.zip",
    key: "openstates_id",
    cursor: "last_updated",
    date: "date",
    rowId: "tweet_id",
    // `last_updated` is present in the DATA file (and is the cursor) but the
    // state dictionary does not document it, so it is verified against the data
    // header at ingest, not asserted here. See the ingest engine's column check.
    required: ["openstates_id", "source", "date", "classified", "tweet_id", ...FLAG_COLUMNS],
    summary:
      "State legislator classified rhetoric, one row per classified tweet. `openstates_id` (ocd-person/uuid) keys the legislator; `position` is upper/lower chamber. `text` is blanked for tweets. The DATA file carries `last_updated` distinct from `date` → revises (though the dictionary omits it). Five 0/1 flags plus model reasoning.",
  },
  "dict-state-profiles": {
    describes: "state-profiles.zip",
    key: "openstates_id",
    cursor: null,
    date: null,
    rowId: "openstates_id",
    required: ["openstates_id", "name", "state", "party", "position", "district", "communication_count", "communication_source"],
    summary:
      "State legislator aggregate profiles, one row per legislator (7,757). `openstates_id` keys; carries identity, contact and socials, `communication_count`, the five `communication_<flag>_mean` shares (0-100) we keep, and `communication_<flag>_rank` within-state ranks — the ranks are refused by the allowlist.",
  },
};

/**
 * Refuse the run if the committed dictionary no longer describes the columns
 * the ingestion reads. A dictionary that dropped `last_updated` would silently
 * turn a revising dataset into an append-only one; better to stop.
 */
export function assertDictionaryColumns(id: PrlDictionaryId, dictionaryHeaderColumnNames: readonly string[]): void {
  const contract = PRL_DICTIONARY_CONTRACTS[id];
  const present = new Set(dictionaryHeaderColumnNames.map((name) => name.trim()));
  const missing = contract.required.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new Error(
      `PRL dictionary ${id} no longer lists ${missing.join(", ")} — the schema moved, and ` +
        "guessing which column replaced it is how a wrong number ships. See lib/sources/prl/dictionaries.ts.",
    );
  }
}

/** The first column of a PRL dictionary CSV is the column name. */
export function dictionaryColumnNames(dictionaryCsvRows: readonly (readonly string[])[]): string[] {
  // Row 0 is the header `COLUMN_NAME,DATA_TYPE,DESCRIPTION`; the column names
  // are cell 0 of every subsequent row.
  return dictionaryCsvRows.slice(1).map((row) => (row[0] ?? "").trim()).filter(Boolean);
}

/**
 * A dataset column is a forbidden rank / percentile / ideology / score, matched
 * against the dictionary's own names — re-exported so archive and profile
 * ingestion share the one allowlist gate `index.ts` established.
 */
export function isForbiddenColumn(name: string): boolean {
  return PRL_FORBIDDEN_COLUMN_PATTERN.test(name);
}
