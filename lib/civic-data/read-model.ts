import type { PromotedProjection, RoutineRecordClass } from "./types.ts";
import { PostgresRoutineDataStore } from "./store.ts";

const TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; value: PromotedProjection | null }>();

/**
 * Server-only read of the single canonical projection row. It never scans raw
 * or normalized candidates and quietly returns null before the one-time seed.
 */
export async function promotedReadModel<T>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
  if (!process.env.DATABASE_URL) return null;
  const key = `${recordClass}:${scope}`;
  const held = cache.get(key);
  if (held && held.expiresAt > Date.now()) return held.value as PromotedProjection<T> | null;
  try {
    const value = await new PostgresRoutineDataStore().readPromotion<T>(recordClass, scope);
    cache.set(key, { expiresAt: Date.now() + TTL_MS, value });
    return value;
  } catch {
    // During the one-time schema rollout, bundled LKG remains readable. A DB
    // read failure is not converted into an empty civic dataset.
    return null;
  }
}

export function clearPromotedReadModelCache(): void {
  cache.clear();
}

