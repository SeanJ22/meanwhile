/**
 * One state's registration, read from its promoted pointer. The promotion engine's verifier and the
 * reader composition both read through it. There is no bootstrap: a state with no promoted registration
 * answers NOT_RECORDED, named as not registered yet, never as a state with no governments.
 */
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions, type PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { RegistrationReadModel } from "./candidate.ts";
import { REGISTRATION_RECORD_CLASS, registrationTarget } from "./publication.ts";
import { readStateReaderEntry } from "../civic-data/state-reader-store.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";

/** Registration is reference data on a Census vintage: a promoted state never goes stale on a clock. */
const REGISTRATION_MAX_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;
const requests = new WeakMap<object, Map<string, Promise<PromotedEdgeEntry>>>();

export async function readRegistrationProjection(
  state: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistrationReadModel>> {
  const target = registrationTarget(state);
  // On a serving-copy miss, read the exact state's verified record. Recursively
  // slicing every government in SQL can time out and abort the ZIP's federal cards.
  const selection = currentReaderSelection();
  if (!options.store && !options.edge && selection) {
    const query = readerQuery();
    if (query) {
      refuseDatabaseInEdgeOnlyContext(`The ${state} registration`);
      const held = requests.get(selection) ?? new Map<string, Promise<PromotedEdgeEntry>>();
      requests.set(selection, held);
      let read = held.get(target.scope);
      if (!read || options.bypassCache) {
        read = readStateReaderEntry(async (text, params) => (await query([{ text, params }]))[0], REGISTRATION_RECORD_CLASS, target.scope);
        held.set(target.scope, read);
      }
      options = { ...options, edge: await read };
    }
  }
  return readPromotedCivicData<RegistrationReadModel>(REGISTRATION_RECORD_CLASS, target.scope, {
    ...options,
    maxAgeMs: options.maxAgeMs ?? REGISTRATION_MAX_AGE_MS,
  });
}
