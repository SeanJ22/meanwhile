/** Independent supporting authorities used after an exact ballot is loaded. */
export type BallotAuxiliaryFamily =
  | "candidate-profiles"
  | "candidate-publications"
  | "federal-funding"
  | "state-money"
  | "federal-directory"
  | "registry-runtime"
  | "nh-members"
  | "ballot-navigation";

/**
 * Settle supporting Reader authorities independently. The canonical ballot
 * must be selected before a caller builds this map; one rejection may withhold
 * only its own family and cannot reject or replace the ballot itself.
 */
export async function settleBallotAuxiliaryPreloads(
  preloads: ReadonlyMap<BallotAuxiliaryFamily, () => Promise<unknown>>,
): Promise<ReadonlyMap<BallotAuxiliaryFamily, PromiseSettledResult<unknown>>> {
  const entries = [...preloads.entries()];
  const outcomes = await Promise.allSettled(
    entries.map(([, preload]) => Promise.resolve().then(preload)),
  );
  return new Map(entries.map(([family], index) => [family, outcomes[index]!]));
}

/** A typed read outcome is usable only when it names an actual projection. */
export function ballotAuxiliaryPreloadSucceeded(
  outcome: PromiseSettledResult<unknown> | undefined,
): boolean {
  if (!outcome || outcome.status === "rejected") return false;
  const value = outcome.value;
  if (!value || typeof value !== "object" || !("kind" in value)) return true;
  return (value as { kind?: unknown }).kind === "PROMOTED" ||
    (value as { kind?: unknown }).kind === "BOOTSTRAP";
}
