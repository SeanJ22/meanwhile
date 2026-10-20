import { federalKeyVoteMemberOfScope, federalMemberOfScope } from "../votes/data-plane.ts";
import type { ReaderRepairContract } from "./reader-repair-protocol.ts";
import { repairRoutineReaderProjectionReadback, type ReaderReadbackRepairOutcome, type ReaderVerifierClosureAttestor } from "./reader-verification.ts";
import type { RoutineDataStore } from "./store.ts";

export interface FanOutReaderRepairSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly deferred: number;
  readonly errors: readonly string[];
}

/** A source's independently published partitions are repaired in place, one at a time.
 * The inventory is scope metadata; no collection of country-wide payloads is read. */
export async function repairFanOutReaderReadbacks(input: {
  readonly store: RoutineDataStore;
  readonly contract: ReaderRepairContract;
  readonly now: string;
  readonly attestor?: ReaderVerifierClosureAttestor;
  readonly repair?: (contract: ReaderRepairContract) => Promise<ReaderReadbackRepairOutcome>;
}): Promise<FanOutReaderRepairSummary> {
  if (!("fanOut" in input.contract) || input.contract.fanOut !== true || !input.store.listPromotionScopes)
    throw new Error("FANOUT_READER_REPAIR_SCOPE_INVENTORY_REQUIRED");
  const prefix = `${input.contract.sourceId}:`;
  const scopes = (await input.store.listPromotionScopes([input.contract.recordClass]))
    .filter(row => row.recordClass === input.contract.recordClass && (input.contract.id === "congress-rollcalls" ? row.scope===input.contract.scope || federalMemberOfScope(row.scope)!==null
        : input.contract.id === "federal-key-votes" ? row.scope===input.contract.scope || federalKeyVoteMemberOfScope(row.scope)!==null
        : input.contract.id === "socrata-discovery" || input.contract.id === "epa-echo" ? row.scope===input.contract.scope ||
          new RegExp(`^${prefix}state:[A-Z]{2}$`).test(row.scope) || row.scope.startsWith(`${prefix}native:`)
        : row.scope !== input.contract.scope && (input.contract.id === "venue-resolutions" ? /^US-[A-Z]{2}:venue-resolutions$/.test(row.scope) : row.scope.startsWith(prefix))));
  let passed = 0, failed = 0, deferred = 0;
  const errors: string[] = [];
  for (const { scope } of scopes) {
    try {
      const contract = { ...input.contract, scope };
      const result = await (input.repair ? input.repair(contract)
        : repairRoutineReaderProjectionReadback(input.store, contract, input.now, undefined, { attestor: input.attestor }));
      if (result.receipt?.status === "FAIL") { failed++; errors.push(`${scope}: ${result.receipt.detail}`); }
      else if (result.receipt?.status === "PASS") passed++;
      else deferred++;
    } catch (error) {
      failed++;
      errors.push(`${scope}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { total: scopes.length, passed, failed, deferred, errors };
}
