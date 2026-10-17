import { candidateEnrichmentProvider, readCandidateEnrichmentAuthorities } from "./candidate-enrichment.ts";
import type { PromotedCivicDataReadOptions } from "../../../civic-data/read-model.ts";
import type { TrackedStatesSource } from "../provider-inputs.ts";
import type { ObligationProvider, ProvidedObligation, ProviderContext } from "../registry.ts";

export async function loadCandidateEnrichmentProvider(trackedStates: TrackedStatesSource, context: ProviderContext,
  options: PromotedCivicDataReadOptions = {}): Promise<ObligationProvider> {
  const tracked = trackedStates.read();
  const obligations: ProvidedObligation[] = [];
  const failures: string[] = [];
  if ("unreadable" in tracked) failures.push(`Tracked states unavailable: ${tracked.unreadable}`);
  else for (const state of tracked.states) {
    const holdings = await readCandidateEnrichmentAuthorities(state, options);
    const yielded = candidateEnrichmentProvider({ holdings, trackedStates: { read: () => ({ states: [state], source: tracked.source }) } }).enumerate(context);
    obligations.push(...yielded.obligations);
    if (yielded.readFailure) failures.push(yielded.readFailure);
  }
  const provider = candidateEnrichmentProvider();
  return { ...provider, enumerate: () => ({ obligations, readFailure: failures.join("; ") || null, emptyReason: null }) };
}
