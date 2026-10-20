import { canonicalCivicDataJson } from "../../lib/civic-data/changes.ts";
import type { PersistedSittingOutcomes } from "../../lib/outcomes/types.ts";
import { isRetainedSourceReplayResponse } from "./retained-source-replay.ts";

export interface DiggerMeasurement {
  readonly subjectId: string;
  readonly readOnly: boolean;
  readonly heldSubjectsWorked: number;
  readonly factsFound: number;
  readonly factsWouldAttach: number;
  readonly byFamily: Readonly<Record<string, { readonly factsFound: number; readonly factsWouldAttach: number }>>;
  readonly requests: number;
  readonly bytesRead?: number;
  readonly dollars: number;
  readonly peakMemoryBytes: number;
  readonly elapsedMs: number;
  readonly incomplete: boolean;
  readonly failures: readonly string[];
}

/** Count reader facts, excluding retrieval clocks and other refresh-only metadata. */
function factualValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(factualValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["provenance", "observedAt", "readAt", "retrievedAt", "collectedAt", "verifiedAt", "readOn"].includes(key))
    .map(([key, child]) => [key, factualValue(child)]));
}

export function diggerMeasurement(subjectId: string, readOnly: boolean) {
  const started = performance.now();
  const families: Record<string, { factsFound: number; factsWouldAttach: number }> = {};
  const failures: string[] = [];
  let requests = 0, bytesRead = 0, subjects = 0, incomplete = false;
  return {
    /** Scope the fetch counter to source acquisition; database reads are excluded. */
    async read<T>(operation: () => Promise<T>): Promise<T> {
      const original = globalThis.fetch;
      globalThis.fetch = (async (url, init) => {
        requests++;
        const response = await original(url, init);
        if (isRetainedSourceReplayResponse(response)) { requests--; return response; }
        if (!response.body) return response;
        const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) { bytesRead += chunk.byteLength; controller.enqueue(chunk); },
        }));
        const measured = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        Object.defineProperties(measured, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
        return measured;
      }) as typeof fetch;
      try { return await operation(); } finally { globalThis.fetch = original; }
    },
    worked() { subjects++; },
    fail(reason: string) { failures.push(reason); incomplete = true; },
    fact(family: string, value: unknown, prior: unknown, attachable = true) {
      const row = families[family] ??= { factsFound: 0, factsWouldAttach: 0 };
      row.factsFound++;
      if (attachable && canonicalCivicDataJson(factualValue(value)) !== canonicalCivicDataJson(factualValue(prior ?? null))) row.factsWouldAttach++;
    },
    sitting(sitting: PersistedSittingOutcomes, prior: PersistedSittingOutcomes | undefined, attachable: boolean) {
      for (const item of sitting.agenda) this.fact("agenda", item, prior?.agenda.find(row => row.eventItemId === item.eventItemId), attachable);
      for (const action of sitting.outcomes) this.fact("outcomes", action, prior?.outcomes.find(row => row.eventItemId === action.eventItemId), attachable);
      for (const roll of sitting.rollCalls) for (const vote of roll.votes) this.fact("votes", vote,
        prior?.rollCalls.find(row => row.eventItemId === roll.eventItemId)?.votes.find(row =>
          vote.personId !== null ? row.personId === vote.personId : row.personName === vote.personName), attachable);
      if (sitting.minutesDocument && sitting.extraction === "RETRIEVED") this.fact("minutes",
        { url: sitting.minutesDocument.url, title: sitting.minutesDocument.title, approval: sitting.minutesDocument.approval.state },
        prior?.minutesDocument && { url: prior.minutesDocument.url, title: prior.minutesDocument.title, approval: prior.minutesDocument.approval.state }, attachable);
    },
    result(): DiggerMeasurement {
      return { subjectId, readOnly, heldSubjectsWorked: subjects,
        factsFound: Object.values(families).reduce((sum, row) => sum + row.factsFound, 0),
        factsWouldAttach: Object.values(families).reduce((sum, row) => sum + row.factsWouldAttach, 0),
        byFamily: families, requests, bytesRead, dollars: 0, peakMemoryBytes: process.resourceUsage().maxRSS * 1024,
        elapsedMs: Math.ceil(performance.now() - started), incomplete, failures };
    },
  };
}
