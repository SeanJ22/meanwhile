/**
 * What kind of source a statement came from — a data list, not a union
 * written into the code (CA-09). Each kind has a reader label. The label is
 * shown only in a passage's Sources row, never on the card face.
 */
import { DEFAULT_KINDS, kindLabel, type KindTable } from "../registry/kinds.ts";
export const SOURCE_KINDS = DEFAULT_KINDS.statement.map(row => ({ kind: row.key, label: row.label }));

/** Runtime statement kinds are validated against the kinds setting. */
export type SnapshotKind = string;

/** Reader label for a source kind. The candidate corpus's `OFFICIAL_SITE`
 *  class is the same thing as an official page. */
export function sourceKindLabel(kind: string, kinds: KindTable = DEFAULT_KINDS): string {
  return kindLabel(kinds, "statement", kind === "OFFICIAL_SITE" ? "OFFICIAL_PAGE" : kind) ?? "source";
}
