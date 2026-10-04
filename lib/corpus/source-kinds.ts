/**
 * What kind of source a statement came from — a data list, not a union
 * written into the code (CA-09). Each kind has a reader label. The label is
 * shown only in a passage's Sources row, never on the card face.
 */
export const SOURCE_KINDS = [
  { kind: "OFFICIAL_PAGE", label: "official page" },
  { kind: "CAMPAIGN_SITE", label: "campaign site" },
  { kind: "FILING", label: "filing" },
  { kind: "VOTER_GUIDE", label: "voter guide" },
  { kind: "NEWS", label: "news" },
  { kind: "SOCIAL_POST", label: "social post" },
  { kind: "FORUM_OR_QUESTIONNAIRE", label: "forum or questionnaire" },
  { kind: "MINUTES", label: "minutes" },
  { kind: "ENDORSEMENT", label: "endorsement" },
] as const;

export type SnapshotKind = (typeof SOURCE_KINDS)[number]["kind"];

const LABELS: ReadonlyMap<string, string> = new Map(
  SOURCE_KINDS.map((k) => [k.kind, k.label]),
);

/** Reader label for a source kind. The candidate corpus's `OFFICIAL_SITE`
 *  class is the same thing as an official page. */
export function sourceKindLabel(kind: string): string {
  return LABELS.get(kind === "OFFICIAL_SITE" ? "OFFICIAL_PAGE" : kind) ?? "source";
}
