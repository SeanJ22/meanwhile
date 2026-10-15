export interface IndependentRuntimeOperation {
  readonly id: string;
  readonly run: () => Promise<void>;
}

export type IndependentRuntimeOutcome =
  | { readonly id: string; readonly state: "COMPLETED"; readonly error: null }
  | { readonly id: string; readonly state: "FAILED"; readonly error: string };

async function settleOperation(operation: IndependentRuntimeOperation): Promise<IndependentRuntimeOutcome> {
  try {
    await operation.run();
    return { id: operation.id, state: "COMPLETED", error: null };
  } catch (error) {
    return {
      id: operation.id,
      state: "FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runIndependentRuntimePass(
  operations: readonly IndependentRuntimeOperation[],
): Promise<readonly IndependentRuntimeOutcome[]> {
  const ids = operations.map((operation) => operation.id);
  if (new Set(ids).size !== ids.length) throw new Error("INDEPENDENT_RUNTIME_OPERATION_IDS_NOT_UNIQUE");
  const running = operations.map(settleOperation);
  return Promise.all(running);
}

export interface IndependentRuntimeLane extends IndependentRuntimeOperation {
  readonly everyMs: number;
  readonly nextDueAt?: () => number | null;
}

export class IndependentRuntimeLaneScheduler {
  readonly #lanes: readonly IndependentRuntimeLane[];
  readonly #onOutcome: (outcome: IndependentRuntimeOutcome) => void;
  readonly #lastStarted = new Map<string, number>();
  readonly #inFlight = new Map<string, Promise<IndependentRuntimeOutcome>>();

  constructor(
    lanes: readonly IndependentRuntimeLane[],
    onOutcome: (outcome: IndependentRuntimeOutcome) => void = () => undefined,
  ) {
    const ids = lanes.map((lane) => lane.id);
    if (new Set(ids).size !== ids.length) throw new Error("INDEPENDENT_RUNTIME_LANE_IDS_NOT_UNIQUE");
    for (const lane of lanes) {
      if (!Number.isSafeInteger(lane.everyMs) || lane.everyMs <= 0) {
        throw new Error(`INDEPENDENT_RUNTIME_LANE_INTERVAL_INVALID:${lane.id}:${lane.everyMs}`);
      }
    }
    this.#lanes = lanes;
    this.#onOutcome = onOutcome;
  }

  tick(nowMs: number, force = false): readonly string[] {
    if (!Number.isFinite(nowMs)) throw new Error(`INDEPENDENT_RUNTIME_TICK_INVALID:${nowMs}`);
    const launched: string[] = [];
    for (const lane of this.#lanes) {
      if (this.#inFlight.has(lane.id)) continue;
      const lastStarted = this.#lastStarted.get(lane.id) ?? Number.NEGATIVE_INFINITY;
      const dueAt = lane.nextDueAt?.() ?? lastStarted + lane.everyMs;
      if (!force && nowMs < dueAt) continue;
      this.#lastStarted.set(lane.id, nowMs);
      launched.push(lane.id);
      const running = settleOperation(lane);
      this.#inFlight.set(lane.id, running);
      void running.then((outcome) => {
        this.#inFlight.delete(lane.id);
        this.#onOutcome(outcome);
      });
    }
    return launched;
  }

  nextDueAt(nowMs: number): number | null {
    let next = Number.POSITIVE_INFINITY;
    for (const lane of this.#lanes) {
      if (this.#inFlight.has(lane.id)) continue;
      next = Math.min(next, lane.nextDueAt?.() ?? (this.#lastStarted.get(lane.id) ?? nowMs) + lane.everyMs);
    }
    return Number.isFinite(next) ? Math.max(nowMs, next) : null;
  }

  inFlightIds(): readonly string[] {
    return [...this.#inFlight.keys()];
  }

  async waitForIdle(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight.values()]);
  }
}
