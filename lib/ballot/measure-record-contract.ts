/** New writes validate kinds against the current runtime table. Historical
 * promoted records retain their keys when Admin later changes that table. */
export type ProvisionKind = string;

interface MeasureSource {
  readonly sourceUrl: string;
  readonly sourceHash: string;
  readonly sourceHashKind?: "CAPTURE_BYTES" | "HELD_TEXT";
  readonly writtenAt: string;
}

export interface MeasureRecord extends MeasureSource {
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
  /** Retained reader parts keep the source and date of the record that supplied them. */
  readonly partSources?: Readonly<Record<string, MeasureSource>>;
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
  if (record.partSources !== undefined && (!record.partSources || typeof record.partSources !== "object" || Array.isArray(record.partSources) ||
      Object.entries(record.partSources).some(([id, source]) => !ids.has(id) || !source ||
        !/^https:\/\//.test(source.sourceUrl) || !/^[a-f0-9]{64}$/.test(source.sourceHash) ||
        !Number.isFinite(Date.parse(source.writtenAt))))) return "A retained measure part lost its original source identity.";
  return null;
}
