/**
 * FE-14: some held labels carry their citation inline, e.g.
 * "County Attorney's Office — 4 Court Street, Concord (read 2026-08-22, example.gov)".
 * The label stays on the card face; the read date and host belong in the
 * card's Sources section. This splits the trailing "(read DATE, HOST)" off.
 */
export interface SplitLabel {
  text: string;
  readAt: string | null;
  host: string | null;
}

const TRAILING_STAMP = /\s*\(read (\d{4}-\d{2}-\d{2})(?:,\s*([^()\s,]+))?\)\s*$/i;

export function splitLabelReadStamp(label: string): SplitLabel {
  const match = TRAILING_STAMP.exec(label);
  if (!match) return { text: label, readAt: null, host: null };
  return { text: label.slice(0, match.index).trim(), readAt: match[1], host: match[2] ?? null };
}

/**
 * A source label that ends ", read YYYY-MM-DD" (the blurb-source rule) gives
 * its read date to the Sources row's "Last checked", so the row never says
 * we are still working on a date the label already states.
 */
export function sourceLabelReadDate(label: string | null | undefined): { org: string; readAt: string } {
  const text = label ?? "";
  const match = /,\s*read (\d{4}-\d{2}-\d{2})\s*$/i.exec(text);
  return match ? { org: text.slice(0, match.index).trim(), readAt: match[1] } : { org: text, readAt: "" };
}
