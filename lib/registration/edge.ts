import { REGISTRATION_TARGETS } from "./publication.ts";

/** Every registration scope, one per state, DC and territory: the pointers the runner reads identities for. */
export const REGISTRATION_SCOPES: readonly string[] = REGISTRATION_TARGETS.map((target) => target.scope);
