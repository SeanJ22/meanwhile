export type BallotAuxiliaryFamily =
  | "candidate-profiles"
  | "candidate-publications"
  | "federal-funding"
  | "federal-directory"
  | "registry-runtime"
  | "nh-members"
  | "ballot-navigation";

/** Start independent reads now; selecting a family later reuses the same result and failure. */
export function ballotAuxiliaryReads() {
  const reads = new Map<BallotAuxiliaryFamily, Promise<unknown>>();
  return (family: BallotAuxiliaryFamily, read: () => Promise<unknown>): (() => Promise<unknown>) => {
    let pending = reads.get(family);
    if (!pending) {
      pending = Promise.resolve().then(read);
      reads.set(family, pending);
      void pending.catch(() => undefined);
    }
    return () => pending;
  };
}

export async function settleBallotAuxiliaryPreloads(
  preloads: ReadonlyMap<BallotAuxiliaryFamily, () => Promise<unknown>>,
): Promise<ReadonlyMap<BallotAuxiliaryFamily, PromiseSettledResult<unknown>>> {
  const entries = [...preloads.entries()];
  const outcomes = await Promise.allSettled(
    entries.map(([, preload]) => Promise.resolve().then(preload)),
  );
  return new Map(entries.map(([family], index) => [family, outcomes[index]!]));
}

export function ballotAuxiliaryPreloadSucceeded(
  outcome: PromiseSettledResult<unknown> | undefined,
): boolean {
  if (!outcome || outcome.status === "rejected") return false;
  const value = outcome.value;
  if (!value || typeof value !== "object" || !("kind" in value)) return true;
  return (value as { kind?: unknown }).kind === "PROMOTED" ||
    (value as { kind?: unknown }).kind === "BOOTSTRAP";
}
