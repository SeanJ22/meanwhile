import type { RoutineSourceContract } from "./contracts.ts";

/** A leaf module, so `contracts.ts` can read it without importing the modules that build the contracts. Replaced in place. */
export const RUNTIME_ROUTINE_CONTRACTS: RoutineSourceContract[] = [];
