/** Read Arizona's authority only for a contest it can actually describe. */
export function azContestRecord<T extends { readonly contestId: string }>(
  contestId: string,
  readRecords: () => readonly T[] | null | undefined,
): T | null {
  if (!contestId.startsWith("ballot-az-")) return null;
  return readRecords()?.find(record => record.contestId === contestId) ?? null;
}
