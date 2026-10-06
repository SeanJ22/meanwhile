import type { RoutineSourceContract } from "./contracts.ts";

/**
 * Routine contracts built at runtime from the door registry (DB-22's per-door outcomes), looked up by
 * `routineContract` beside the code's own list. A leaf module so `contracts.ts` can read it without importing the
 * modules that build the contracts. Empty until a pass reads the registry's doors; replaced in place.
 */
export const RUNTIME_ROUTINE_CONTRACTS: RoutineSourceContract[] = [];
