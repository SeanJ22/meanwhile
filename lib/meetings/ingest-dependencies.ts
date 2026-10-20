import { refreshRegistryRuntimeFromPromoted } from "../registry/runtime-read-model.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { ATTESTED_PROMOTIONS_ENV, attestedPromotionFor, parseAttestedPromotions } from "../civic-data/attested-promotion.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { refreshVenueResolutionsFromPromoted } from "../civic-data/curated-reader-read-model.ts";

export async function preloadCanonicalMeetingDependencies(input: {
  readonly sourceName: string;
  readonly state: string;
  readonly refreshRegistry?: (states: readonly string[], options: PromotedCivicDataReadOptions) => Promise<unknown>;
  readonly refreshVenues?: () => Promise<unknown>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const refreshRegistry = input.refreshRegistry ?? refreshRegistryRuntimeFromPromoted;
  const refreshVenues = input.refreshVenues ?? refreshVenueResolutionsFromPromoted;
  // The supervisor proved the registry once for this pass; a malformed or
  // absent attestation leaves this child's own full proof in place.
  const attested = attestedPromotionFor(
    parseAttestedPromotions((input.env ?? process.env)[ATTESTED_PROMOTIONS_ENV]),
    "REGISTRY_RUNTIME_BINDING",
    stateRegistryRuntimeScope(input.state),
  );
  await Promise.all([
    refreshRegistry([input.state], attested ? { attested } : {}),
    ...(input.sourceName === "composite" || input.sourceName === "legistar"
      ? [refreshVenues()]
      : []),
  ]);
}
