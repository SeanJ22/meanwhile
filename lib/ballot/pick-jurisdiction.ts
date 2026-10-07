export function jurisdictionKeyForContestId(contestId: string): string | null {
  const match = /^ballot-([a-z]{2}-[a-z-]+):/.exec(contestId);
  return match ? match[1] : null;
}

export const PICK_JURISDICTION_LABELS: Record<string, string> = {
  "az-pima": "Pima County, Arizona",
  "nh-merrimack": "Merrimack County, New Hampshire",
  "nj-morris": "Morris County, New Jersey",
};

export function pickJurisdictionLabel(contestId: string): string | null {
  const key = jurisdictionKeyForContestId(contestId);
  return key ? (PICK_JURISDICTION_LABELS[key] ?? null) : null;
}

export function isForeignPick(
  contestId: string,
  currentKey: string | null,
): boolean {
  if (!currentKey) return false;
  const key = jurisdictionKeyForContestId(contestId);
  return key !== null && key !== currentKey;
}
