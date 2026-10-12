export type BallotAuxiliaryFamily =
  | "candidate-profiles"
  | "candidate-publications"
  | "federal-funding"
  | "state-money"
  | "federal-directory"
  | "registry-runtime"
  | "nh-members"
  | "ballot-navigation";

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
