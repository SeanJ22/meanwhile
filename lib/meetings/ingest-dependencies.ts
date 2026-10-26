import { refreshRegistryRuntimeFromPromoted } from "../registry/runtime-read-model.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { refreshVenueResolutionsFromPromoted } from "../civic-data/curated-reader-read-model.ts";

export async function preloadCanonicalMeetingDependencies(input: {
  readonly sourceName: string;
  readonly state: string;
  readonly refreshRegistry?: (states: readonly string[], options: PromotedCivicDataReadOptions) => Promise<unknown>;
  readonly refreshVenues?: () => Promise<unknown>;
}): Promise<void> {
  const refreshRegistry = input.refreshRegistry ?? refreshRegistryRuntimeFromPromoted;
  const refreshVenues = input.refreshVenues ?? refreshVenueResolutionsFromPromoted;
  await Promise.all([
    refreshRegistry([input.state], {}),
    ...(input.sourceName === "composite" || input.sourceName === "legistar"
      ? [refreshVenues()]
      : []),
  ]);
}
