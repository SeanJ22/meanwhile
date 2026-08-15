/**
 * Which ballot a saved pick was made on (4c, 2026-08-15) — the author's
 * production pass.
 *
 * The report: open the New Hampshire ballot with Arizona picks already stored
 * and the Arizona picks are listed, unlabelled. The BEHAVIOUR is right —
 * picks are the reader's private note, they live on the device, and silently
 * deleting them because the reader looked at another state's ballot would
 * lose work they did on purpose. What was missing is the sign. A list headed
 * "My picks" under New Hampshire's contests reads as picks for New Hampshire,
 * and two of those rows were for a governor's race 2,500 miles away.
 *
 * The jurisdiction is not stored on the pick and does not need to be: a
 * contest id already carries it (`ballot-az-pima:governor`), so this is read
 * off data every pick already holds, including picks saved before today. No
 * migration, and nothing new is collected.
 *
 * The plain-language rule applies at full strength here. `az-pima` is an
 * internal key and may never reach a reader, so a key with no label in the
 * map below renders NOTHING rather than leaking the identifier — the same
 * bargain the rest of the app makes. Adding a ballot source means adding a
 * row here, and `tests/ballot-picks.test.ts` fails the build if a shipped
 * ballot's contests have no label.
 */

/** `ballot-az-pima:governor` → `az-pima`. Null for anything else shaped. */
export function jurisdictionKeyForContestId(contestId: string): string | null {
  const match = /^ballot-([a-z]{2}-[a-z-]+):/.exec(contestId);
  return match ? match[1] : null;
}

/**
 * Reader-facing names, one per wired ballot jurisdiction.
 *
 * Written the way a person says where they live, county first — the reader
 * who stored these picks knows their county name and may not recognise a
 * bare state next to a race they remember marking in town.
 */
export const PICK_JURISDICTION_LABELS: Record<string, string> = {
  "az-pima": "Pima County, Arizona",
  "nh-merrimack": "Merrimack County, New Hampshire",
  "nj-morris": "Morris County, New Jersey",
};

/** The label for a contest's jurisdiction, or null when we cannot say. */
export function pickJurisdictionLabel(contestId: string): string | null {
  const key = jurisdictionKeyForContestId(contestId);
  return key ? (PICK_JURISDICTION_LABELS[key] ?? null) : null;
}

/**
 * Whether a pick belongs to a ballot other than the one being viewed.
 *
 * `currentKey` null means the page resolved no ballot at all — with nothing
 * to differ FROM, nothing is foreign, and labelling every row then would be
 * noise rather than a sign.
 */
export function isForeignPick(
  contestId: string,
  currentKey: string | null,
): boolean {
  if (!currentKey) return false;
  const key = jurisdictionKeyForContestId(contestId);
  return key !== null && key !== currentKey;
}
