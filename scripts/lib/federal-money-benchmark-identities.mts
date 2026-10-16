import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { validateRoutineCandidate } from "../../lib/civic-data/validate.ts";
import { heldRegistrationReceipt } from "../../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel } from "../../lib/registration/candidate.ts";
import type { RegistrationGovernmentListing } from "../../lib/registration/listings.ts";
import { registrationTarget } from "../../lib/registration/publication.ts";
import { loadRegistrationReference } from "../../lib/registration/reference.ts";
import { FederalMoneyBenchmarkStore } from "./federal-money-benchmark-store.mts";

export async function seedFederalMoneyBenchmarkIdentities(store: FederalMoneyBenchmarkStore, seedDirectory: string, states: readonly string[], repositoryRoot = process.cwd()) {
  if (!(store instanceof FederalMoneyBenchmarkStore)) throw new Error("Federal benchmark identities require the isolated benchmark database.");
  let governments = 0, divisions = 0, seededStates = 0;
  for (const state of states) {
    if (state.toUpperCase() === "ZZ") continue;
    const target = registrationTarget(state);
    const [existing] = await store.query([{ text: "SELECT 1 FROM civic_data_promotions WHERE record_class = 'REGISTRATION' AND scope = $1", params: [target.scope] }]);
    if (existing.length) continue;
    const listings: RegistrationGovernmentListing[] = [];
    const lines = createInterface({ input: createReadStream(join(seedDirectory, "seeds", `${state.toLowerCase()}.jsonl`)), crlfDelay: Infinity });
    for await (const line of lines) {
      const seed = JSON.parse(line) as { government: RegistrationGovernmentListing | null; state: string; uei: string };
      if (seed.state.toUpperCase() !== target.state) throw new Error("Benchmark identity seed crossed its source state.");
      if (seed.government) {
        if (seed.government.nativeIds.uei !== seed.uei) throw new Error("Benchmark government is missing its prepared UEI.");
        listings.push(seed.government);
      }
    }
    const reference = { ...loadRegistrationReference(repositoryRoot, target.state), listings };
    const candidate = registrationCandidate({ target, reference, receipt: heldRegistrationReceipt() });
    const at = new Date().toISOString();
    const validation = validateRoutineCandidate(candidate, null, at);
    if (validation.state !== "VALIDATED") throw new Error(`Benchmark registration fixture failed validation: ${JSON.stringify(validation.receipt.checks.filter(check => check.verdict !== "PASS"))}`);
    await store.query([{
      text: "WITH fixture AS (SELECT $1::jsonb AS candidate, $2::jsonb AS receipt)" +
        " INSERT INTO civic_data_candidates (id, source_id, record_class, scope, state, acquisition_succeeded, raw_hash, normalized_hash," +
        " retrieved_at, source_through, parser_version, identity, candidate, validation_receipt, promoted_version_id, last_known_good_version_id)" +
        " SELECT candidate->>'id', candidate->>'sourceId', candidate->>'recordClass', candidate->>'scope', 'PROMOTED', true," +
        " candidate#>>'{retrieval,rawHash}', candidate#>>'{normalization,normalizedHash}', (candidate#>>'{retrieval,retrievedAt}')::timestamptz," +
        " candidate#>>'{temporal,sourceThrough}', candidate#>>'{normalization,parserVersion}', candidate->'identities', candidate, receipt, candidate->>'id', candidate->>'id' FROM fixture",
      params: [JSON.stringify(candidate), JSON.stringify(validation.receipt)],
    }, ...["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].map((state, index) => ({
      text: "INSERT INTO civic_data_candidate_events (candidate_id, sequence, state, at, detail) VALUES ($1, $2, $3, $4::timestamptz, 'Prepared synthetic-UEI benchmark registration fixture')",
      params: [candidate.id, index + 1, state, at],
    })), {
      text: "INSERT INTO civic_data_promotions (key, source_id, record_class, scope, current_version_id, last_known_good_version_id, promoted_at, payload, validation_receipt)" +
        " SELECT record_class || ':' || scope, source_id, record_class, scope, id, id, $2::timestamptz, candidate->'readModel', validation_receipt FROM civic_data_candidates WHERE id = $1",
      params: [candidate.id, at],
    }]);
    const model = candidate.readModel as RegistrationReadModel;
    governments += model.governments?.length ?? 0; divisions += model.divisions.length; seededStates++;
  }
  return { states: seededStates, governments, divisions };
}
