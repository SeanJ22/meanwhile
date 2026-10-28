import type { Contest, Measure } from "./types.ts";

/** The publisher's designation, never a number assigned from the display order. */
export function measureTitle(contest: Pick<Contest, "title" | "filing">, measure: Pick<Measure, "officialNumber" | "questionText"> | null): string {
  const designation = measure?.officialNumber?.trim()
    || /^(?:ballot\s+)?(?:proposition|prop\.?|question|issue|measure|initiative|referendum|(?:constitutional\s+)?amendment)\s+(?:(?:no\.?|number|#)\s*)?[a-z0-9]+(?:-[a-z0-9]+)*(?=$|[\s:—–.])/i
      .exec(contest.filing?.publishedTitle ?? "")?.[0]?.trim();
  if (!designation) return contest.title;
  const normalized = (text: string) => text.toLowerCase().replace(/\b(?:no\.?|number)\s*|#/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const numberOnly = /^(?:\d+|[a-z]{1,2})$/i.test(designation);
  if (numberOnly ? new RegExp(`\\b(?:question|proposition|prop|measure|issue|amendment|initiative|referendum)\\s+${designation}\\b`, "i").test(normalized(contest.title))
      || new RegExp(`^${designation}[.:\\s—–-]`, "i").test(contest.title)
    : normalized(contest.title).includes(normalized(designation))) return contest.title;
  return `${designation} — ${contest.title}`;
}
