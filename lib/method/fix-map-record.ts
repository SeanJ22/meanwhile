import { applyFixResult, latestWorking, methodWorksOf, methodStatistics, type FixMapRepository, type FixMapRow } from "./fix-map.ts";

export const ATTEMPT_KINDS = ["SCOUT", "DETECTIVE", "ROUTE_RUN", "ACQUIRER_VERDICT", "AUDIT"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export interface MethodAttempt {
  readonly kind: AttemptKind;
  /** Stable for one attempt, so a replay of the same attempt is the same write. */
  readonly attemptId: string;
  /** The place the method was used on (a division id). */
  readonly placeId: string;
  /** Every reusable method the attempt actually used. */
  readonly methodIds: readonly string[];
  /** SUCCEEDED and FAILED are results; INCONCLUSIVE says nothing about the method. */
  readonly outcome: "SUCCEEDED" | "FAILED" | "INCONCLUSIVE";
  /** Why a failed attempt failed, in a sentence. Required for FAILED. */
  readonly cause?: string | null;
  readonly at: string;
}

/** The rows an attempt writes: none when it could not tell, one per distinct method otherwise. */
export function fixResultsFromAttempt(attempt: MethodAttempt): FixMapRow[] {
  if (attempt.outcome === "INCONCLUSIVE") return [];
  if (attempt.placeId.trim() === "" || attempt.attemptId.trim() === "" || !Number.isFinite(Date.parse(attempt.at))) return [];
  const cause = attempt.outcome === "FAILED" ? (attempt.cause?.trim() || `the ${attempt.kind.toLowerCase().replace(/_/g, " ")} did not succeed`) : null;
  return [...new Set(attempt.methodIds.map((id) => id.trim()).filter(Boolean))].sort().map((methodId) => ({
    methodId,
    placeId: attempt.placeId,
    state: attempt.outcome === "SUCCEEDED" ? "WORKS" : "FAILS",
    triedAt: attempt.at,
    attemptId: attempt.attemptId,
    cause,
    updatedAt: attempt.at,
  }));
}

export interface RecordedAttempts {
  readonly written: number;
  readonly skipped: number;
  readonly failed: number;
}

export async function recordAttempts(repo: Pick<FixMapRepository, "put">, attempts: readonly MethodAttempt[]): Promise<RecordedAttempts> {
  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const attempt of attempts) {
    const rows = fixResultsFromAttempt(attempt);
    if (rows.length === 0) {
      skipped += 1;
      continue;
    }
    for (const row of rows) {
      try {
        await repo.put(row);
        written += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { written, skipped, failed };
}

/** An in-memory fix map with the same replace rules as the table, for tests and dry runs. */
export function memoryFixMap(): FixMapRepository & { readonly rows: () => readonly FixMapRow[] } {
  const rows = new Map<string, FixMapRow>();
  const key = (r: Pick<FixMapRow, "methodId" | "placeId">): string => `${r.methodId}\u0000${r.placeId}`;
  return {
    rows: () => [...rows.values()],
    forPlace: async (placeId) => [...rows.values()].filter((r) => r.placeId === placeId).sort((a, b) => (a.methodId < b.methodId ? -1 : 1)),
    forPlaces: async (methodId, placeIds) => [...new Set(placeIds)].sort().flatMap(placeId => {
      const row = rows.get(key({ methodId, placeId }));
      return row ? [row] : [];
    }),
    statistics: async (methodId, recentSince, before) => methodStatistics([...rows.values()].filter(row => row.methodId === methodId), recentSince, before),
    worksFor: async (methodIds) => methodWorksOf([...rows.values()], methodIds),
    workingMethods: async (limit = 200) => latestWorking([...rows.values()], limit),
    put: async (row) => { rows.set(key(row), applyFixResult(rows.get(key(row)) ?? null, row)); },
  };
}
