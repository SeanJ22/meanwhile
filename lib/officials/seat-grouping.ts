/**
 * One heading per body, however many seats it has (ALIGN-2, 2026-08-26, the
 * author's 8/26 walkthrough).
 *
 * ## The instance, and the class it is an instance of
 *
 * The who-governs card printed `U.S. Senator` twice at every Arizona zip —
 * once above Mark Kelly and once above Ruben Gallego — because the render
 * mapped over PEOPLE and emitted a heading per person. Sean's spec is one
 * heading, `U.S. Senators`, with both names listed beneath it.
 *
 * **RULING 136: the senators are the example and the defect is the class.**
 * Any body holding more than one seat has the same shape — a two-member state
 * house district, five county supervisors, a multi-member school board — and
 * fixing the Senate alone would leave every one of those printing a repeated
 * label. So the grouping lives here, once, and the surfaces call it.
 *
 * ## Why the label is pluralised here and not at the call site
 *
 * A call site that pluralises is a call site that can forget, and there are
 * three of them. It is also the exact shape RULING 103 was adopted over —
 * three separate copies of an initials function, each with the same bug. The
 * pluraliser is deliberately conservative: it declines to guess rather than
 * inventing a wrong plural for a person's office, because an office title is
 * a claim about a named person's job.
 */

/** One heading and the people under it. */
export interface SeatGroup<T> {
  /** The heading as rendered — pluralised when it carries more than one. */
  label: string;
  /** The heading exactly as it arrived, for callbacks that name the office. */
  singular: string;
  members: T[];
}

/**
 * The plural of an office title, or the title unchanged where we cannot tell.
 *
 * The last word is the only one inflected, which is right for the titles this
 * product actually holds (`U.S. Senator`, `County Supervisor`, `School Board
 * Member`, `Selectman`). Where the last word is already plural — `Board of
 * Supervisors` — it is left alone rather than doubled, because `Supervisorses`
 * is worse than a heading that reads slightly stiffly.
 *
 * This is presentation only. Nothing downstream reads it and nothing is
 * inferred from it.
 */
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
    // Singular offices that are held by exactly one person. If two ever
    // arrive under one of these, that is a FINDING about the data rather than
    // a heading to pluralise, and the caller keeps the singular so the
    // oddness stays visible instead of being smoothed away.
    return trimmed;
  }

  let plural: string;
  if (/(?:ch|sh|x|z)$/i.test(word)) plural = `${word}es`;
  else if (/[^aeiou]y$/i.test(word)) plural = `${word.slice(0, -1)}ies`;
  else if (/man$/i.test(word)) plural = `${word.slice(0, -3)}men`;
  else plural = `${word}s`;

  return `${head}${plural}${tail}`;
}

/**
 * Consecutive entries sharing a label, folded into one group.
 *
 * CONSECUTIVE and not global, deliberately. The card's order is meaningful —
 * district scope before statewide, closest first — and a global regroup would
 * silently reorder people to make its own grouping tidier. Two runs of the
 * same label separated by a different one stay two groups, which is the honest
 * rendering of an order somebody chose.
 *
 * RULING 159: an empty input returns an empty array and the caller is
 * responsible for not calling this a count. There is nothing to earn here —
 * zero people is zero groups — but a caller reporting "N bodies" from this
 * must say so from its own list.
 */
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
