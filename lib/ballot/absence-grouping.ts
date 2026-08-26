/**
 * **BAL-24 (2026-08-25) — TWO NEAR-IDENTICAL ABSENCE BLOCKS, AND WHY THEY ARE
 * NOT A DUPLICATE.**
 *
 * ## The root cause, which is the thing Sean asked for rather than a dedupe
 *
 * His capture `17-46-00` carries two bordered blocks at the foot of the 07866
 * ballot, one arrow drawn between them, both opening `NO LOCAL ELECTION — the
 * Morris County Clerk's 2026 general-election candidate list carries this entry
 * for …`. Read as an image rather than skimmed, they differ by two words:
 * **one is DENVILLE TOWNSHIP and the other is ROCKAWAY TOWNSHIP.**
 *
 * So this is **not one record arriving through two paths**, which is what a
 * repeated annotation usually means and what the brief asked to be checked
 * first. It is **two records about two different governments**, both true, both
 * sourced to the same clerk's document, both read on the same day. The zip
 * 07866 straddles Denville and Rockaway, so a reader there is owed both facts.
 *
 * **Filtering the output would have deleted a true statement about a real
 * municipality** — the thing this product exists not to do. Merging them
 * deletes nothing: every jurisdiction is still named, the source and the read
 * date are still cited, and the reader gets one sentence instead of the same
 * sentence twice.
 *
 * ## What is merged, and the bar is deliberately strict
 *
 * Only absences that agree on **the statement's shape**, **the source
 * organisation**, **the source URL** and **the read date**. Any difference in
 * any of those and they render separately, because two statements from two
 * authorities, or read on two days, are two claims and collapsing them would
 * put one date and one citation in front of both.
 *
 * The shape is the statement with its jurisdiction removed. That is derived
 * from the statement itself rather than from a jurisdiction field, because
 * `BallotAbsence` carries an `ocdId` and not a display name, and re-deriving a
 * display name here would be a second implementation of something the statement
 * already contains (RULING 103).
 */
import type { BallotAbsence } from "./types.ts";

export interface GroupedAbsence {
  /** Stable across renders: the ocd ids of every absence in the group. */
  key: string;
  /** Every absence this group carries, in the order they arrived. */
  members: BallotAbsence[];
  /** The sentence to render. Identical to the single statement when n === 1. */
  statement: string;
  provenance: BallotAbsence["provenance"];
}

/**
 * Split a statement into the part before the jurisdiction, the jurisdiction,
 * and the part after.
 *
 * Returns `null` where the sentence does not carry the shape — which is the
 * honest answer and means the absence never groups, rather than being forced
 * into a group by a looser guess.
 */
export function splitJurisdiction(
  statement: string,
): { before: string; jurisdiction: string; after: string } | null {
  // `[\s\S]` rather than the `s` (dotAll) flag — this repo's tsconfig target
  // predates ES2018, where `/s` is a compile error rather than a runtime one.
  const m = /^([\s\S]*\bfor )([^:]+)(:[\s\S]*)$/.exec(statement);
  if (!m) return null;
  const [, before, jurisdiction, after] = m;
  if (!before || !jurisdiction || !after) return null;
  return { before, jurisdiction: jurisdiction.trim(), after };
}

/** Join names the way a sentence does: "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function groupAbsences(absences: readonly BallotAbsence[]): GroupedAbsence[] {
  const order: string[] = [];
  const buckets = new Map<string, { parts: ReturnType<typeof splitJurisdiction>; members: BallotAbsence[] }>();

  for (const absence of absences) {
    const parts = splitJurisdiction(absence.statement);
    const p = absence.provenance;
    // An absence whose sentence does not carry the shape gets its own bucket,
    // keyed on its ocd id, so it renders exactly as it always has.
    const key = parts
      ? `${parts.before}\u0000${parts.after}\u0000${p.sourceOrg ?? ""}\u0000${p.sourceUrl ?? ""}\u0000${p.collectedAt ?? ""}`
      : `solo\u0000${absence.ocdId}`;
    if (!buckets.has(key)) {
      buckets.set(key, { parts, members: [] });
      order.push(key);
    }
    buckets.get(key)!.members.push(absence);
  }

  return order.map((key) => {
    const bucket = buckets.get(key)!;
    const { parts, members } = bucket;
    const first = members[0]!;
    if (!parts || members.length === 1) {
      return {
        key: members.map((m) => m.ocdId).join("|"),
        members,
        statement: first.statement,
        provenance: first.provenance,
      };
    }
    const names = members
      .map((m) => splitJurisdiction(m.statement)?.jurisdiction)
      .filter((n): n is string => Boolean(n));
    return {
      key: members.map((m) => m.ocdId).join("|"),
      members,
      statement: `${parts.before}${listNames(names)}${parts.after}`,
      provenance: first.provenance,
    };
  });
}
