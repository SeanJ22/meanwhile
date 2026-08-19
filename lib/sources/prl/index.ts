import {
  PRL_CATEGORIES,
  PRL_FORBIDDEN_COLUMN_PATTERN,
  PRL_RHETORIC_ATTRIBUTION,
  type PrlCategoryKey,
  type PrlMemberProfile,
} from "./types.ts";

/**
 * **The PRL profiles adapter** — D62's v1 build shape: the aggregated
 * legislator profiles, joined to our roster by bioguide.
 *
 * `fetch` / `normalize` / `upsert` is the source convention, and this file is
 * the whole of the source: adding PRL meant adding a directory, not editing
 * shared ingestion logic.
 *
 * ## What crosses the boundary, and what is refused at it
 *
 * The source file has 51 columns. **Seventeen of them are ranks,
 * percentiles or an ideology score**, and none of those may exist in our
 * records at any remove — a rank is a ranking of named politicians against
 * each other, and it does not become acceptable because a university
 * computed it.
 *
 * So the filter is an ALLOWLIST, checked against the file's own header:
 * `normalizeProfiles` reads only the columns named in `PRL_CATEGORIES` plus
 * the count, the sources and the stamp, and `assertNoForbiddenColumns`
 * refuses the whole run if any column it is about to read matches the
 * forbidden pattern. A denylist would let PRL add a column and have it
 * arrive silently.
 *
 * ## A share is never rendered without its denominator
 *
 * PRL supplies both a `_sum` and a `_mean` per category. The mean IS the
 * share, and it is carried through as PRL computed it rather than
 * recomputed here — recomputing would make us the author of the number.
 * `statementCount` rides with every profile because a share without its base
 * is a naked percentage, which this codebase has now caught itself printing
 * more than once.
 */

/** A minimal CSV reader: quotes, embedded commas, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * The columns this adapter is allowed to read, derived from the category
 * table rather than typed twice.
 */
export function allowedColumns(): string[] {
  return [
    "bioguide_id",
    "full_name",
    "communication_count",
    "communication_source",
    "communication_last_update",
    ...PRL_CATEGORIES.map((c) => `${c.column}_mean`),
  ];
}

/**
 * Refuse the run if any column we are about to read is a rank, a percentile
 * or an ideology score.
 *
 * This can only fire if the allowlist above is edited carelessly — which is
 * the point. The check is on the columns we READ, so a future session adding
 * `ideology_ideology` to the allowlist because it looked useful gets a
 * failure rather than a shipped ranking.
 */
export function assertNoForbiddenColumns(columns: string[]): void {
  const bad = columns.filter((c) => PRL_FORBIDDEN_COLUMN_PATTERN.test(c));
  if (bad.length > 0) {
    throw new Error(
      `PRL: refusing to read ${bad.join(", ")} — a rank, percentile or ideology ` +
        "score may not enter this product's records at any remove. " +
        "See lib/sources/prl/types.ts.",
    );
  }
}

export interface NormalizeResult {
  profiles: PrlMemberProfile[];
  /** Every count this run must state (the no-silent-empty rule). */
  counts: {
    rowsInFile: number;
    rowsWithStatements: number;
    rosterAsked: number;
    matched: number;
    droppedNoStatements: number;
  };
  rosterMisses: string[];
}

/**
 * Read the profiles CSV into records for the roster bioguides asked for.
 *
 * Reports fetched / matched / dropped with denominators, because an
 * operation that can return nothing must be asked what it returned.
 */
export function normalizeProfiles(
  csv: string,
  rosterBioguides: readonly string[],
): NormalizeResult {
  const rows = parseCsv(csv).filter((r) => r.length > 1);
  if (rows.length === 0) {
    throw new Error("PRL: the profiles file parsed to zero rows");
  }
  const header = rows[0];
  const wanted = allowedColumns();
  assertNoForbiddenColumns(wanted);

  const at = new Map(header.map((h, i) => [h, i]));
  for (const column of wanted) {
    if (!at.has(column)) {
      throw new Error(
        `PRL: the file has no column "${column}" — the schema moved, and ` +
          "guessing which column replaced it is how a wrong number ships.",
      );
    }
  }

  const asked = new Set(rosterBioguides);
  const data = rows.slice(1).filter((r) => r[at.get("bioguide_id")!]);
  let rowsWithStatements = 0;
  let droppedNoStatements = 0;
  const profiles: PrlMemberProfile[] = [];
  const seen = new Set<string>();

  for (const row of data) {
    const bioguideId = row[at.get("bioguide_id")!].trim();
    const count = Number(row[at.get("communication_count")!]);
    if (Number.isFinite(count) && count > 0) rowsWithStatements += 1;
    if (!asked.has(bioguideId)) continue;
    if (!Number.isFinite(count) || count <= 0) {
      // A member PRL holds with nothing classified is a member with no
      // measurement — never a member who says nothing.
      droppedNoStatements += 1;
      continue;
    }

    const shares = {} as Record<PrlCategoryKey, number | null>;
    for (const category of PRL_CATEGORIES) {
      const raw = row[at.get(`${category.column}_mean`)!];
      const value = raw === "" || raw === undefined ? null : Number(raw);
      shares[category.key] = Number.isFinite(value as number)
        ? (value as number)
        : null;
    }

    profiles.push({
      bioguideId,
      prlName: row[at.get("full_name")!].trim(),
      statementCount: Math.round(count),
      shares,
      sources: (row[at.get("communication_source")!] ?? "")
        .split(/[;,|]/)
        .map((s) => s.trim())
        .filter(Boolean),
      measuredAt: (row[at.get("communication_last_update")!] ?? "").slice(0, 10),
    });
    seen.add(bioguideId);
  }

  return {
    profiles,
    counts: {
      rowsInFile: data.length,
      rowsWithStatements,
      rosterAsked: asked.size,
      matched: profiles.length,
      droppedNoStatements,
    },
    // Named, never implied: a roster member with no PRL row is a gap we can
    // point at, and the surface says so rather than rendering nothing.
    rosterMisses: [...asked].filter((b) => !seen.has(b)).sort(),
  };
}

/**
 * The sentence a reader gets under a category bar. **PRL's measurement, in
 * PRL's name, with the denominator** — never the app's voice, and never a
 * statement about what the person believes.
 */
export function shareSentence(
  profile: PrlMemberProfile,
  category: PrlCategoryKey,
): string | null {
  const share = profile.shares[category];
  if (share === null) return null;
  const entry = PRL_CATEGORIES.find((c) => c.key === category);
  if (!entry) return null;
  // The stored value is a PERCENTAGE, 0-100, as PRL computed it. It is not a
  // fraction and it is not recomputed here — see PrlMemberProfile.shares for
  // what reading the file rather than assuming its units caught.
  const percent = share > 0 && share < 1 ? "under 1%" : `${Math.round(share)}%`;
  // TWO OF PRL'S NUMBERS, JOINED BY NOTHING. The share's own base is not
  // exactly `statementCount`, so "N% of the 16,056" would be an arithmetic
  // claim we cannot support. Both are stated, both attributed, neither
  // multiplied by the other.
  return (
    `${PRL_RHETORIC_ATTRIBUTION.text} classifies ${percent} of this member's ` +
    `public statements as ${entry.label}. It has ` +
    `${profile.statementCount.toLocaleString("en-US")} statements on file for them.`
  );
}
