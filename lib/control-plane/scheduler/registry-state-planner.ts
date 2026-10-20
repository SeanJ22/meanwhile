import { clearPromotedReadModelCache } from "../../civic-data/read-model.ts";
import { clearRegistrationJurisdictionRegistries, installOperationalReferenceState, releaseOperationalReferenceState, requiredJurisdictionRegistry } from "../../civic-data/operational-references.ts";
import type { JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";
import { readOperationalReferenceState } from "../../civic-data/operational-reference-state-read.ts";
import { stateOfJurisdictionId, preloadRegistrationJurisdictions } from "../../registration/jurisdictions.ts";
import { createMeetingPartitionOwnership } from "./meeting-ownership.ts";
import type { MaterializedReading } from "./provider-inputs.ts";
import { buildRegistry, type ProviderContext, type RegistryPass } from "./registry.ts";
import { huntPacketsProvider } from "./providers/hunt-packets.ts";
import { campaignFinanceProvider } from "./providers/campaign-finance.ts";
import { localJurisdictionsProvider } from "./providers/local-jurisdictions.ts";
import { loadCandidateEnrichmentProvider } from "./providers/candidate-enrichment-loader.ts";
import { meetingsDiscoveryProvider } from "./providers/meetings-discovery.ts";
import { askGapsProvider, type AskGapsInput } from "./providers/ask-gaps.ts";
import { promotedRegistries as importRegistered } from "./provider-inputs.ts";

/** A packet keeps its canonical government identity inside its obligation key. */
export function plannerStateOf(id: string): string {
  return /\/(?:state|district|territory):([a-z]{2})(?:[/#:]|$)/i.exec(id)?.[1]?.toLowerCase() ?? stateOfJurisdictionId(id) ?? "us";
}

export interface RegistryStateAuthority { readonly registry: JurisdictionRegistry | null; readonly ownership: ReturnType<typeof createMeetingPartitionOwnership>; readonly failure: string | null }
export async function withRegistryState(input: {
  readonly state: string; readonly root: string; readonly trackedStates: ReadonlySet<string>; readonly registration: boolean;
  readonly readReviewedState?: typeof readOperationalReferenceState; readonly hydrateRegistration?: typeof preloadRegistrationJurisdictions;
  readonly ownership?: ReturnType<typeof createMeetingPartitionOwnership>;
}, visit: (authority: RegistryStateAuthority) => Promise<void>): Promise<void> {
  const state = input.state.toLowerCase();
  clearRegistrationJurisdictionRegistries(); releaseOperationalReferenceState(); clearPromotedReadModelCache();
  const ownership = input.ownership ?? createMeetingPartitionOwnership({ root: input.root }); let failure: string | null = null;
  try {
    try {
      if (input.trackedStates.has(state)) {
        const read = await (input.readReviewedState ?? readOperationalReferenceState)(state);
        installOperationalReferenceState(read.registry, [...input.trackedStates]);
      } else if (state !== "us" && input.registration) {
        const read = await (input.hydrateRegistration ?? preloadRegistrationJurisdictions)({ root: input.root, states: [state], options: { bypassCache: true } });
        failure = read.refused.get(state) ?? null;
      }
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    if (state !== "us" && (input.registration || input.trackedStates.has(state))) await ownership.readStates([state]);
    let registry: JurisdictionRegistry | null = null;
    if (state !== "us" && !failure) try { registry = requiredJurisdictionRegistry(state); } catch {}
    await visit({ registry, ownership, failure });
  } finally { ownership.release(); clearRegistrationJurisdictionRegistries(); releaseOperationalReferenceState(); clearPromotedReadModelCache(); }
}

/** Enumerate one hydrated state, transfer its work to the temporary planner, then release its native facts. */
export async function forEachStateRegistry(input: {
  readonly context: ProviderContext;
  readonly states: Iterable<string>;
  readonly trackedStates: ReadonlySet<string>;
  readonly materialized: (state: string) => MaterializedReading;
  readonly askGaps: (state: string) => Promise<AskGapsInput>;
  readonly visit: (state: string, pass: RegistryPass, authority: RegistryStateAuthority) => Promise<void>;
  readonly readReviewedState?: typeof readOperationalReferenceState;
  readonly hydrateRegistration?: typeof preloadRegistrationJurisdictions;
  readonly hydrateRegistrations?: boolean;
}): Promise<void> {
  for (const raw of input.states) {
    const state = raw.toLowerCase(), tracked = input.trackedStates.has(state), ownMaterialized = input.materialized(state);
    const needsRegistry = tracked || input.hydrateRegistrations === true || "ids" in ownMaterialized && ownMaterialized.ids.size > 0;
    await withRegistryState({ state, root: input.context.root, trackedStates: input.trackedStates, registration: needsRegistry,
      readReviewedState: input.readReviewedState, hydrateRegistration: input.hydrateRegistration }, async authority => {
      const { ownership, failure: registryFailure } = authority;
      const trackedSource = { read: () => ({ states: tracked ? [state] : [], source: "the promoted operational-reference state index" }) };
      const materialized = () => ownMaterialized;
      const providers = [huntPacketsProvider({ materialized }), campaignFinanceProvider(undefined, state),
        localJurisdictionsProvider({ trackedStates: registryFailure ? { read: () => ({ unreadable: registryFailure!, source: "this state's promoted registry" }) } : trackedSource,
          materialized, meetingPartitions: ownership }),
        ...(tracked ? [await loadCandidateEnrichmentProvider(trackedSource, input.context, { bypassCache: true })] : []),
        meetingsDiscoveryProvider({ materialized, registered: () => {
          if (registryFailure) return { unreadable: registryFailure };
          if (state === "us" || !needsRegistry) return { registries: new Map(), refused: new Map() };
          // Only this state's facts are installed while its providers enumerate.
          return importRegistered();
        } }), askGapsProvider(await input.askGaps(state))];
      await input.visit(state, buildRegistry(providers, input.context), authority);
    });
  }
}
