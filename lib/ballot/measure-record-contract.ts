/** New writes validate kinds against the current runtime table. Historical
 * promoted records retain their keys when Admin later changes that table. */
export type ProvisionKind = string;

export interface MeasureRecord {
  readonly contestId: string;
  readonly whatItDoes: string;
  readonly yesMeans: string | null;
  readonly noMeans: string | null;
  readonly parts: readonly {
    readonly id: string;
    /** The source's own number; null when the held row does not record it. */
    readonly number: string | null;
    readonly kind: ProvisionKind;
    readonly label: string;
    readonly what: string;
  }[];
  readonly sourceUrl: string;
  readonly sourceHash: string;
  readonly sourceHashKind?: "CAPTURE_BYTES" | "HELD_TEXT";
  readonly writtenAt: string;
  readonly citation?: "azleg-analysis" | "measure-source";
}

export function measureRecordIssue(record: MeasureRecord): string | null {
  if (!record || typeof record.contestId !== "string" || !record.contestId || typeof record.whatItDoes !== "string" || !record.whatItDoes.trim() ||
      !/^https:\/\//.test(record.sourceUrl) || !/^[a-f0-9]{64}$/.test(record.sourceHash) ||
      !Number.isFinite(Date.parse(record.writtenAt)) || !Array.isArray(record.parts) ||
      ![record.yesMeans, record.noMeans].every(value => value === null || typeof value === "string")) {
    return "Measure record lacks its text or source identity.";
  }
  const ids = new Set<string>();
  for (const part of record.parts) {
    if (!part || typeof part.id !== "string" || !part.id.startsWith(`${record.contestId}#`) || ids.has(part.id) ||
        typeof part.kind !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(part.kind) ||
        typeof part.label !== "string" || !part.label.trim() || typeof part.what !== "string" || !part.what.trim() ||
        !(part.number === null || typeof part.number === "string" && part.number.trim())) {
      return "Measure part lacks its stable identity or source text.";
    }
    ids.add(part.id);
  }
  return null;
}
