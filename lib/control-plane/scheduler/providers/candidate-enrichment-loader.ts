import { candidateEnrichmentProvider, readCandidateEnrichmentAuthorities } from "./candidate-enrichment.ts";
import type { PromotedCivicDataReadOptions } from "../../../civic-data/read-model.ts";
import type { TrackedStatesSource } from "../provider-inputs.ts";
import type { ObligationProvider, ProvidedObligation, ProviderContext } from "../registry.ts";
import { readRegistryRuntimeProjection } from "../../../registry/runtime-read-model.ts";
import { heldSubjectDetails, heldSubjectEnrichmentObligations, type HeldGovernmentDetails } from "./held-subject-enrichment.ts";
import { requiredJurisdictionRegistry } from "../../../civic-data/operational-references.ts";
import { readStateFederalDirectory } from "../../../officials/federal-directory-read-model.ts";
import type { Officeholder } from "../../../officials/types.ts";
import { factReader } from "../../../facts/db.ts";
import type { Clocks, Query } from "../../../facts/publish.ts";
import { readHeldFactClocks, readHeldSubjectProgress } from "./held-subject-progress.ts";
import { readHeldRosterSubjects } from "./held-subject-rosters.ts";

export interface CandidateEnrichmentProgressDependencies {
  readonly query?: Query | null;
  readonly clocks?: Clocks;
  readonly readClocks?: () => Promise<Clocks>;
}

export async function loadCandidateEnrichmentProvider(trackedStates: TrackedStatesSource, context: ProviderContext,
  options: PromotedCivicDataReadOptions = {}, progress: CandidateEnrichmentProgressDependencies = {}): Promise<ObligationProvider> {
  const tracked = trackedStates.read();
  const obligations: ProvidedObligation[] = [];
  const failures: string[] = [];
  const factQuery = progress.query === undefined ? factReader() : progress.query;
  let clocks: Clocks | null = progress.clocks ?? null;
  if (!clocks && factQuery && "states" in tracked && tracked.states.length) {
    try { clocks = await (progress.readClocks ?? readHeldFactClocks)(); }
    catch { failures.push("Held detail freshness clocks could not be read (HELD_FACT_CLOCKS_UNREADABLE); their field gaps stay owed."); }
  }
  if (!factQuery && "states" in tracked && tracked.states.length) failures.push("Held detail facts could not be read (FACT_STORE_UNCONFIGURED); their field gaps stay owed.");
  if ("unreadable" in tracked) failures.push(`Tracked states unavailable: ${tracked.unreadable}`);
  else for (const state of tracked.states) {
    const holdings = await readCandidateEnrichmentAuthorities(state, options);
    const yielded = candidateEnrichmentProvider({ holdings, trackedStates: { read: () => ({ states: [state], source: tracked.source }) } }).enumerate(context);
    obligations.push(...yielded.obligations);
    if (yielded.readFailure) failures.push(yielded.readFailure);
    try {
      const registry = await readRegistryRuntimeProjection([state], options);
      if (registry.kind === "PROMOTED") {
        let governments: HeldGovernmentDetails[] = [];
        let people: readonly Officeholder[] = [];
        try {
          const directory = await readStateFederalDirectory(state, options);
          if (directory.kind === "PROMOTED" || directory.kind === "BOOTSTRAP") people = directory.value.roster.officeholders;
        } catch (error) {
          failures.push(`${state.toUpperCase()} held official profiles could not be read (${error instanceof Error ? error.message : String(error)}); other known sources continue.`);
        }
        try {
          const held = requiredJurisdictionRegistry(state);
          governments = held.jurisdictions.map(({ id, name, stateCode, ownWebAddress, ocdId, bodyId, censusId, govClass }) =>
            ({ id, name, stateCode, ownWebAddress, ocdId, bodyId, censusId, govClass, checkedAt: held.generatedOn }));
        } catch (error) {
          failures.push(`${state.toUpperCase()} held governments could not be read (${error instanceof Error ? error.message : String(error)}); held officials and bodies continue.`);
        }
        let heldRegistry = registry.value;
        let subjects = heldSubjectDetails(heldRegistry, state, context.nowIso, governments, people);
        if (factQuery) {
          try {
            const live = await readHeldRosterSubjects(factQuery, heldRegistry, state, context.nowIso);
            heldRegistry = live.registry;
            subjects = heldSubjectDetails(heldRegistry, state, context.nowIso, governments, people);
            if (live.identityGaps.length) failures.push(`${state.toUpperCase()} held member aliases are ambiguous (HELD_MEMBER_IDENTITY_AMBIGUOUS); those identities stay unresolved.`);
          } catch { failures.push(`${state.toUpperCase()} held member identities could not be read (HELD_MEMBER_IDENTITIES_UNREADABLE); other held subjects continue.`); }
        }
        if (factQuery && clocks) {
          try { subjects = heldSubjectDetails(heldRegistry, state, context.nowIso, governments, people,
            await readHeldSubjectProgress(factQuery, subjects, clocks)); }
          catch { failures.push(`${state.toUpperCase()} held detail progress could not be read (HELD_FACT_PROGRESS_UNREADABLE); its field gaps stay owed.`); }
        }
        obligations.push(...heldSubjectEnrichmentObligations(subjects));
      }
      else failures.push(`${state.toUpperCase()} held bodies could not be read (${registry.kind}); their enrichment stays owed.`);
    } catch (error) {
      failures.push(`${state.toUpperCase()} held bodies could not be read (${error instanceof Error ? error.message : String(error)}); their enrichment stays owed.`);
    }
  }
  const provider = candidateEnrichmentProvider();
  return { ...provider, describe: `${provider.describe}; every owed detail family for held bodies, officials and governments from their known sources`,
    enumerate: () => ({ obligations, readFailure: failures.join("; ") || null, emptyReason: null }) };
}
