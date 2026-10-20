/**
 * One state's registration, read from its promoted pointer. The promotion engine's verifier and the
 * reader composition both read through it. There is no bootstrap: a state with no promoted registration
 * answers NOT_RECORDED, named as not registered yet, never as a state with no governments.
 */
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { RegistrationReadModel } from "./candidate.ts";
import { REGISTRATION_RECORD_CLASS, registrationTarget } from "./publication.ts";

/** Registration is reference data on a Census vintage: a promoted state never goes stale on a clock. */
const REGISTRATION_MAX_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export async function readRegistrationProjection(
  state: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistrationReadModel>> {
  const target = registrationTarget(state);
  return readPromotedCivicData<RegistrationReadModel>(REGISTRATION_RECORD_CLASS, target.scope, {
    ...options,
    maxAgeMs: options.maxAgeMs ?? REGISTRATION_MAX_AGE_MS,
  });
}
