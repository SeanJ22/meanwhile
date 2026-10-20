import type { CostEntry } from "./cost.ts";
import { pricedModelCharge, type PricedCharge } from "./fleet-safety.ts";
import { fingerprint } from "./ids.ts";
import type { AggregateArrayRetention, ControlPlaneRepositories } from "./repository/types.ts";
import { RESEARCH_BOUNDS } from "./scheduler/research-policy.ts";
import { filterIterable, mapIterable, retainSpendScratch, spendScratch } from "./spend-scratch.ts";

/** The existing running counter; only its exact members and finite metadata leave the store. */
export interface SpendWindow {
  readonly charges: readonly PricedCharge[];
  readonly seedState?: "SEEDING" | "READY";
}
export interface SpendCharges extends Iterable<PricedCharge> {
  readonly size: number;
  get(id: string): PricedCharge | null;
  forJob(jobId: string): Iterable<PricedCharge>;
  filter(keep: (charge: PricedCharge) => boolean): Iterable<PricedCharge>;
  close(): void;
}
type Repositories = Pick<ControlPlaneRepositories, "costs" | "spendWindow" | "locks">;
export const SPEND_WINDOW_ID = "model-charges";
const keepMs = (): number => (RESEARCH_BOUNDS.windowHours + 6) * 3_600_000;
const CAS_ATTEMPTS = 6;

export function costRecordId(entry: Pick<CostEntry, "attemptId" | "routeTaskId" | "recordedAt">): string {
  return `ce-${fingerprint([entry.attemptId, entry.routeTaskId, entry.recordedAt])}`;
}
export function mapCharges<T>(charges: Iterable<PricedCharge>, map: (charge: PricedCharge) => T): Iterable<T> {
  return mapIterable(charges, map);
}
function retention(now: string): AggregateArrayRetention {
  return {limit: 2_147_483_647, discardPath: ["id"], discardValue: "", oldestPath: ["at"],
    pruneBefore: {path: ["at"], at: new Date(Date.parse(now) - keepMs()).toISOString()}};
}
function snapshot() {
  const scratch = spendScratch(), {db, owner} = scratch;
  const add = db.prepare("INSERT OR IGNORE INTO charges(owner,id,job,body) VALUES(?,?,?,?)");
  const one = db.prepare("SELECT body FROM charges WHERE owner=? AND id=?");
  let closed = false;
  const requireOpen = () => { if (closed) throw new Error("SPEND_WINDOW_SNAPSHOT_CLOSED"); };
  const charges: SpendCharges = {
    get size() { requireOpen(); return Number(db.prepare("SELECT COUNT(*) AS count FROM charges WHERE owner=?").get(owner)?.count); },
    get(id) { requireOpen(); const row = one.get(owner,id); return row ? JSON.parse(String(row.body)) as PricedCharge : null; },
    forJob(jobId) { return {[Symbol.iterator]: function* () {
      requireOpen();
      for (const row of db.prepare("SELECT body FROM charges WHERE owner=? AND job=? ORDER BY sequence").iterate(owner,jobId))
        yield JSON.parse(String(row.body)) as PricedCharge;
    }}; },
    filter(keep) { return filterIterable(charges, keep); },
    [Symbol.iterator]: function* () {
      requireOpen();
      for (const row of db.prepare("SELECT body FROM charges WHERE owner=? ORDER BY sequence").iterate(owner))
        yield JSON.parse(String(row.body)) as PricedCharge;
    },
    close() { if (!closed) { closed = true; scratch.release(); } },
  };
  retainSpendScratch(charges,owner);
  return {charges, add: (charge: PricedCharge) => add.run(owner,charge.id,charge.jobId,JSON.stringify(charge))};
}
async function appendCharge(repos: Repositories, charge: PricedCharge, now: string): Promise<void> {
  const store = repos.spendWindow;
  if (!store.readArrayPage || !store.compareAndSetArrayItem) throw new Error("SPEND_WINDOW_NATIVE_ARRAY_API_REQUIRED");
  for (let attempt = 1; ; attempt++) {
    const row = await store.readArrayPage(SPEND_WINDOW_ID,"charges", {match: {path: ["id"],value: charge.id},limit: 1,projection: {id: true}});
    if (!row) throw new Error("SPEND_WINDOW_COUNTER_MISSING");
    if (row.values.length) return;
    try {
      await store.compareAndSetArrayItem(SPEND_WINDOW_ID,row.revision,"charges",["id"],charge.id,charge,now,retention(now));
      return;
    } catch (error) { if (attempt >= CAS_ATTEMPTS) throw error; }
  }
}
/** Partial first seeds refuse spend readings. Killed seeds resume from the ledger under the existing operational lock. */
async function ensureSeeded(repos: Repositories, now: string): Promise<void> {
  const existing = await repos.spendWindow.readNarrowed(SPEND_WINDOW_ID,{seedState: true});
  if (existing && (existing.value as SpendWindow).seedState !== "SEEDING") return;
  await repos.locks.withLock("spend-window:first-seed",async () => {
    let current = await repos.spendWindow.readNarrowed(SPEND_WINDOW_ID,{seedState: true});
    if (current && (current.value as SpendWindow).seedState !== "SEEDING") return;
    if (!current) await repos.spendWindow.put(SPEND_WINDOW_ID,{charges: [],seedState: "SEEDING"},now);
    const since = Date.parse(now) - keepMs();
    await repos.costs.readChangedSince(null,undefined,{page: async rows => {
      for (const {record} of rows) {
        const charge = pricedModelCharge(record,costRecordId(record));
        if (charge && Date.parse(charge.at) >= since) await appendCharge(repos,charge,now);
      }
    }});
    if (!repos.spendWindow.compareAndSetFields) throw new Error("SPEND_WINDOW_NATIVE_ARRAY_API_REQUIRED");
    for (let attempt = 1; ; attempt++) {
      current = await repos.spendWindow.readNarrowed(SPEND_WINDOW_ID,{seedState: true});
      if (!current) throw new Error("SPEND_WINDOW_COUNTER_MISSING");
      try { await repos.spendWindow.compareAndSetFields(SPEND_WINDOW_ID,current.revision,{seedState: "READY"},now); break; }
      catch (error) { if (attempt >= CAS_ATTEMPTS) throw error; }
    }
  });
}
/** Repeatable native snapshot. Unique immutable ids prevent concurrent prefix pruning from skipping live charges. */
export async function readSpendWindow(repos: Repositories, now: string): Promise<SpendCharges> {
  await ensureSeeded(repos,now);
  if (!repos.spendWindow.readArrayPage) throw new Error("SPEND_WINDOW_NATIVE_ARRAY_API_REQUIRED");
  const held = snapshot(), since = Date.parse(now) - keepMs();
  try {
    let after: string | undefined;
    do {
      const page = await repos.spendWindow.readArrayPage(SPEND_WINDOW_ID,"charges",{limit: 32,order: {path: ["id"],after}});
      if (!page) throw new Error("SPEND_WINDOW_COUNTER_MISSING");
      for (const value of page.values) {
        const charge = value as PricedCharge;
        if (typeof charge.id !== "string" || typeof charge.jobId !== "string") throw new Error("SPEND_WINDOW_CHARGE_INVALID");
        if (Date.parse(charge.at) >= since) held.add(charge);
      }
      after = page.nextKey ?? undefined;
    } while (after !== undefined);
    return held.charges;
  } catch (error) { held.charges.close(); throw error; }
}
/** One exact append and timestamp pruning happen atomically without transferring the country array. */
export async function countCharge(repos: Repositories, entry: CostEntry, now: string): Promise<void> {
  const charge = pricedModelCharge(entry,costRecordId(entry));
  if (!charge) return;
  const row = await repos.spendWindow.readNarrowed(SPEND_WINDOW_ID,{seedState: true});
  if (!row) await ensureSeeded(repos,now);
  await appendCharge(repos,charge,now);
}
