/**
 * **ONE STATE'S REGISTRATION, READ FROM ITS PROMOTED POINTER.** (2026-09-23.)
 *
 * The typed reader for the REGISTRATION record class: the promotion engine's
 * source-scoped verifier reads a candidate back through it before a pointer
 * moves, and the reader composition reads each state it needs through it.
 * There is no first seed and no bootstrap: a state with no promoted
 * registration answers NOT_RECORDED, which every consumer names as not
 * registered yet — never as a state with no governments.
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
