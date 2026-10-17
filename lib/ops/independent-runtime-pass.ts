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

/**
 * Launch independent standing operations in the same turn, contain a thrown
 * operation to its own outcome, and wait for every operation before returning.
 * The caller therefore cannot start an overlapping tick while one child from
 * the current tick is still live.
 */
export async function runIndependentRuntimePass(
  operations: readonly IndependentRuntimeOperation[],
): Promise<readonly IndependentRuntimeOutcome[]> {
  const ids = operations.map((operation) => operation.id);
  if (new Set(ids).size !== ids.length) throw new Error("INDEPENDENT_RUNTIME_OPERATION_IDS_NOT_UNIQUE");
  const running = operations.map(settleOperation);
  return Promise.all(running);
}

export interface IndependentRuntimeLane {
  readonly id: string;
  readonly everyMs: number;
  /** A run ends by its start plus this; whatever it has not finished stays owed to the next tick. */
  readonly budgetMs: number;
  readonly run: (deadlineMs: number) => Promise<void>;
}

/**
 * Per-lane clocks keep a slow civic-data acquisition from delaying intake (and
 * vice versa). `tick` never waits on a lane, while each lane admits at most one
 * live run. All failures are delivered as outcomes rather than rejections.
 */
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
      if (!Number.isSafeInteger(lane.budgetMs) || lane.budgetMs <= 0) {
        throw new Error(`INDEPENDENT_RUNTIME_LANE_BUDGET_INVALID:${lane.id}:${lane.budgetMs}`);
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
      if (!force && nowMs - lastStarted < lane.everyMs) continue;
      this.#lastStarted.set(lane.id, nowMs);
      launched.push(lane.id);
      const running = settleOperation({ id: lane.id, run: () => lane.run(nowMs + lane.budgetMs) });
      this.#inFlight.set(lane.id, running);
      void running.then((outcome) => {
        this.#inFlight.delete(lane.id);
        this.#onOutcome(outcome);
      });
    }
    return launched;
  }

  inFlightIds(): readonly string[] {
    return [...this.#inFlight.keys()];
  }

  /** Every run ends by its own deadline, so this waits at most the longest budget. */
  async waitForIdle(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight.values()]);
  }
}

/** Where a standing child learns the deadline its lane gave it. */
const PASS_DEADLINE_ENV = "WTP_PASS_DEADLINE_AT";

/** A standing child's environment with its lane deadline. */
export function withPassDeadline(env: NodeJS.ProcessEnv, deadlineMs: number): NodeJS.ProcessEnv {
  return { ...env, [PASS_DEADLINE_ENV]: new Date(deadlineMs).toISOString() };
}

/** The deadline a standing child was given; none when run by hand. */
export function passDeadlineFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const at = Date.parse(env[PASS_DEADLINE_ENV] ?? "");
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}
