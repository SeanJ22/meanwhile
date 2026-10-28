import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import type { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Progress changes after each published county; its saved page and original
 * count baselines do not. Store those once, including copies in change sets. */
export async function storeFederalMoneyCheckpoint(candidate: RoutineCandidate, parts: Pick<CivicPayloadParts, "store">): Promise<RoutineCandidate> {
  const pending = new Map<string, Record<string, unknown>>();
  const visit = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      const rows: unknown[] = [];
      let changed = false;
      for (const row of value) { const next = await visit(row); rows.push(next); changed ||= next !== row; }
      return changed ? rows : value;
    }
    if (!record(value)) return value;
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const [key, child] of Object.entries(value)) {
      let next: unknown;
      if (key === "pending" && record(child) && record(child.page) && record(child.baselines) && Array.isArray(child.priorLocations)) {
        const identity = canonicalCivicDataJson({ page: child.page, baselines: child.baselines, priorLocations: child.priorLocations });
        let shared = pending.get(identity);
        if (!shared) {
          shared = await parts.store(JSON.parse(identity), [], ["page", "baselines", "priorLocations"]) as Record<string, unknown>;
          pending.set(identity, shared);
        }
        next = { ...child, ...shared };
      } else next = await visit(child);
      out[key] = next; changed ||= next !== child;
    }
    return changed ? out : value;
  };
  return await visit(candidate) as RoutineCandidate;
}
