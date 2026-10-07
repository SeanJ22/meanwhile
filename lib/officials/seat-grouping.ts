/** One heading per body, however many seats it holds. */

/** One heading and the people under it. */
export interface SeatGroup<T> {
  /** The heading as rendered — pluralised when it carries more than one. */
  label: string;
  /** The heading exactly as it arrived, for callbacks that name the office. */
  singular: string;
  members: T[];
}

/** The plural of an office title by inflecting the last word, or the title unchanged. Presentation only. */
export function pluralizeOffice(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return trimmed;

  const match = /^(.*?)([A-Za-z]+)(\W*)$/.exec(trimmed);
  if (!match) return trimmed;
  const [, head, word, tail] = match;

  const lower = word.toLowerCase();
  // Already plural, or a word whose plural this has no business guessing.
  if (lower.endsWith("s") || lower.endsWith("people")) return trimmed;
  if (lower === "chair" || lower === "mayor" || lower === "governor") {
    // Singular offices held by one person: two under one is a finding about the data, so the heading stays singular.
    return trimmed;
  }

  let plural: string;
  if (/(?:ch|sh|x|z)$/i.test(word)) plural = `${word}es`;
  else if (/[^aeiou]y$/i.test(word)) plural = `${word.slice(0, -1)}ies`;
  else if (/man$/i.test(word)) plural = `${word.slice(0, -3)}men`;
  else plural = `${word}s`;

  return `${head}${plural}${tail}`;
}

/** Consecutive entries sharing a label, folded into one group; never a global regroup, which would reorder people. */
export function groupBySeatLabel<T>(
  entries: readonly { label: string; member: T }[],
): SeatGroup<T>[] {
  const groups: SeatGroup<T>[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.singular === entry.label) {
      last.members.push(entry.member);
      last.label = pluralizeOffice(entry.label);
      continue;
    }
    groups.push({
      label: entry.label,
      singular: entry.label,
      members: [entry.member],
    });
  }
  return groups;
}
