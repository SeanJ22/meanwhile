import type { CostEntry } from "./cost.ts";
import { pricedModelCharge, type PricedCharge } from "./fleet-safety.ts";
import { fingerprint } from "./ids.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { RESEARCH_BOUNDS } from "./scheduler/research-policy.ts";

/** The running spend counter: every model charge recorded in the last day and a margin, priced as it was written. */
export interface SpendWindow {
  readonly charges: readonly PricedCharge[];
}

export const SPEND_WINDOW_ID = "model-charges";

/** A writer's clock can run ahead of the store's, so charges stay this long past the longest window any reader asks for. */
const keepMs = (): number => (RESEARCH_BOUNDS.windowHours + 6) * 3_600_000;

const CAS_ATTEMPTS = 6;

/** The ledger's record id for a cost row; an append and its count share it, so neither ever counts twice. */
export function costRecordId(entry: Pick<CostEntry, "attemptId" | "routeTaskId" | "recordedAt">): string {
  return `ce-${fingerprint([entry.attemptId, entry.routeTaskId, entry.recordedAt])}`;
}

function kept(charges: readonly PricedCharge[], now: string): PricedCharge[] {
  const since = Date.parse(now) - keepMs();
  return charges.filter(charge => Date.parse(charge.at) >= since);
}

/* The counter's first write prices the ledger's rows still inside its span, once. */
async function seeded(repos: Pick<ControlPlaneRepositories, "costs">, now: string): Promise<PricedCharge[]> {
  const rows = await repos.costs.readSince(new Date(Date.parse(now) - keepMs()).toISOString());
  return rows.flatMap(entry => pricedModelCharge(entry, costRecordId(entry)) ?? []);
}

/** Every model charge the counter holds; the first read on a new store builds it from the ledger. */
export async function readSpendWindow(repos: Pick<ControlPlaneRepositories, "costs" | "spendWindow">, now: string): Promise<readonly PricedCharge[]> {
  for (let attempt = 1; ; attempt++) {
    const row = await repos.spendWindow.read(SPEND_WINDOW_ID);
    if (row !== null) return kept(row.value.charges, now);
    try {
      const charges = kept(await seeded(repos, now), now);
      await repos.spendWindow.put(SPEND_WINDOW_ID, { charges }, now);
      return charges;
    } catch (error) { if (attempt >= CAS_ATTEMPTS) throw error; }
  }
}

/** Counts one ledger row's model charge; plain code and search invoices change nothing. */
export async function countCharge(repos: Pick<ControlPlaneRepositories, "costs" | "spendWindow">, entry: CostEntry, now: string): Promise<void> {
  const charge = pricedModelCharge(entry, costRecordId(entry));
  if (charge === null) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const row = await repos.spendWindow.read(SPEND_WINDOW_ID);
      if (row === null) {
        const charges = (await seeded(repos, now)).filter(held => held.id !== charge.id);
        await repos.spendWindow.put(SPEND_WINDOW_ID, { charges: kept([...charges, charge], now) }, now);
        return;
      }
      if (row.value.charges.some(held => held.id === charge.id)) return;
      await repos.spendWindow.compareAndSet(SPEND_WINDOW_ID, row.revision, { charges: kept([...row.value.charges, charge], now) }, now);
      return;
    } catch (error) { if (attempt >= CAS_ATTEMPTS) throw error; }
  }
}
