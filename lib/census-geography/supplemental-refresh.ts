import type { BuiltScope, GeographySourceFailure } from "./dataset.ts";

/** A source failure retains that exact published scope, including its original check date. */
export function retainFailedSupplementalScopes(previous: readonly BuiltScope[], built: readonly BuiltScope[], failures: readonly GeographySourceFailure[]): BuiltScope[] {
  const scopes = new Map(built.map(scope => [`${scope.type}|${scope.version}`, scope]));
  for (const failure of failures) {
    const prior = previous.find(scope => scope.type === failure.type && scope.version === failure.version);
    if (prior && !scopes.has(`${prior.type}|${prior.version}`)) scopes.set(`${prior.type}|${prior.version}`, prior);
  }
  return [...scopes.values()];
}
