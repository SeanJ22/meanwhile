import { isDivisionsOwnGovernment } from "@/lib/officials/division-government";
import type { CoverageSummary } from "@/lib/registry/coverage";

/**
 * A compact meeting label from sourced coverage only. A ZIP that contains
 * more than one municipality cannot honestly pick one, so it falls back to
 * the ZIP itself rather than guessing which place belongs to the reader.
 */
export function meetingAreaLabel(
  coverage: CoverageSummary | null | undefined,
  zip: string | null | undefined,
): string {
  const municipalities = new Map<string, string>();
  for (const body of coverage?.bodies ?? []) {
    if (
      body.divisionType === "place" &&
      isDivisionsOwnGovernment(body.bodyId, body.ocdId, body.divisionType)
    ) {
      municipalities.set(body.ocdId ?? body.bodyId, body.divisionLabel);
    }
  }
  if (municipalities.size === 1) {
    return `${[...municipalities.values()][0]} meetings`;
  }
  return /^\d{5}$/.test(zip ?? "") ? `${zip} meetings` : "Meetings";
}
