export type ProvisionKind = "FUNDING" | "PROGRAM" | "OVERSIGHT" | "SUNSET" | "START";

/** Stored inside the ballot's civic-data projection, with stable reaction keys. */
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
        !["FUNDING", "PROGRAM", "OVERSIGHT", "SUNSET", "START"].includes(part.kind) ||
        typeof part.label !== "string" || !part.label.trim() || typeof part.what !== "string" || !part.what.trim() ||
        !(part.number === null || typeof part.number === "string" && part.number.trim())) {
      return "Measure part lacks its stable identity or source text.";
    }
    ids.add(part.id);
  }
  return null;
}

