/**
 * The discovery search seam over Brave and Exa (`hunt/search.ts`),
 * pointers only. Every provider request is admitted first by the cycle's search
 * cap, a per-day cap across both providers in the durable shared budget ledger
 * (vendor `discovery-search`), and FleetSafety on its own provider key.
 *
 * A refused request is BUDGET_REFUSED and never sent; a transport failure is
 * FAILED with UNMEASURED cost. `worstCaseMs` covers every provider at its
 * timeout plus the ledger's calls; a query starts only with that much time left.
 */

import type { BudgetLedger, HostBudget, VendorBudget } from "../budget.ts";
import { createLedger, tryAcquire, release } from "../budget.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { SearchHit } from "../../hunt/search.ts";
import { braveSearch, exaSearch, SEARCH_HOSTS, SEARCH_REQUEST_LIFETIME_MS, type FetchLike } from "../../hunt/search.ts";
import type { DiscoverySearch, SearchRequestRecord } from "./meetings-discovery-executor.ts";

export const DISCOVERY_SEARCH_VENDOR = "discovery-search";
export { SEARCH_HOSTS };
/** Time allowed per query for the budget ledger's admission and release calls, on top of the provider requests. */
const SEARCH_LEDGER_ALLOWANCE_MS = 2_000;

function hostBudget(host: string): HostBudget {
  return {
    host,
    maxConcurrent: 1,
    minIntervalMs: 1_000,
    dailyRequestCap: null,
    backoffUntil: null,
    observedCrawlDelayMs: null,
    vendor: DISCOVERY_SEARCH_VENDOR,
  };
}

function vendorBudget(perDay: number): VendorBudget {
  return { vendor: DISCOVERY_SEARCH_VENDOR, maxConcurrent: 2, dailyRequestCap: perDay, backoffUntil: null };
}

/**
 * The ledger with the two search hosts and the combined daily cap registered
 * where they are missing. It never changes an entry that is already there: a
 * cap someone set is theirs.
 */
export function withSearchBudgets(ledger: BudgetLedger, perDay: number): BudgetLedger {
  const seeded = createLedger({
    hosts: Object.values(SEARCH_HOSTS).map(hostBudget),
    vendors: [vendorBudget(perDay)],
  });
  return {
    ...ledger,
    hosts: { ...seeded.hosts, ...ledger.hosts },
    hostState: { ...seeded.hostState, ...ledger.hostState },
    vendors: { ...seeded.vendors, ...ledger.vendors },
  };
}

/** Only expired search occupancy is reclaimed; limits, spend and backoff survive. */
export function recoverSearchSlots(ledger: BudgetLedger, now: string): BudgetLedger {
  const hostState = { ...ledger.hostState };
  for (const host of Object.values(SEARCH_HOSTS)) {
    const state = hostState[host];
    if (state?.inFlight > 0 && state.lastRequestAt !== null &&
      Date.parse(now) - Date.parse(state.lastRequestAt) > SEARCH_REQUEST_LIFETIME_MS) {
      hostState[host] = { ...state, inFlight: 0 };
    }
  }
  return { ...ledger, hostState };
}

/** Admits one provider request, or says why not. `done` returns the concurrency slot. */
export interface SearchBudget {
  take(host: string): Promise<string | null>;
  done(host: string): Promise<void>;
}

/**
 * The durable budget: a per-cycle count held here, the per-day cap in the
 * shared ledger (installed with only the search budgets when no ledger exists),
 * and the caller's FleetSafety admission.
 */
export function durableSearchBudget(input: {
  readonly repos: Pick<ControlPlaneRepositories, "budget">;
  readonly perCycle: number;
  readonly perDay: number;
  /** FleetSafety admission on the search key; returns a refusal reason, or null. */
  readonly admit: () => string | null;
  /** Admission for an already-bound member of the original lifetime hunt. */
  readonly admitLifetimeHunt?: () => string | null;
  readonly now: () => string;
}): SearchBudget & { readonly used: () => number; readonly lifetimeHunt: SearchBudget } {
  let used = 0;
  let registered = false;
  const held = new Map<string, string[]>();
  const remember = (host: string, at: string) => held.set(host, [...(held.get(host) ?? []), at]);
  async function register(): Promise<void> {
    if (registered) return;
    try {
      await input.repos.budget.read();
    } catch {
      await input.repos.budget.install(withSearchBudgets(createLedger({ hosts: [] }), input.perDay), input.now());
    }
    await input.repos.budget.mutate((ledger) => ({ ledger: withSearchBudgets(ledger, input.perDay), result: null }), input.now());
    registered = true;
  }
  const done = async (host: string) => {
    const at = held.get(host)?.shift();
    if (at === undefined) return;
    await input.repos.budget.mutate(ledger => ({
      // A late release from an expired holder must not consume its replacement's slot.
      ledger: ledger.hostState[host]?.lastRequestAt === at ? release(ledger, host) : ledger,
      result: null,
    }), input.now());
  };
  return {
    used: () => used,
    async take(host) {
      if (used >= input.perCycle) return `the cycle's ${input.perCycle}-request search budget is spent`;
      const refused = input.admit();
      if (refused !== null) return refused;
      await register();
      const at = input.now();
      const { result: acquired } = await input.repos.budget.mutate(ledger => {
        const acquired = tryAcquire(recoverSearchSlots(ledger, at), host, at);
        return { ledger: acquired.ledger, result: acquired };
      }, at);
      if (!acquired.granted) return acquired.reason;
      remember(host, at);
      used += 1;
      return null;
    },
    done,
    lifetimeHunt: {
      async take(host) {
        if (!input.admitLifetimeHunt) return "lifetime-hunt search admission is unavailable";
        const refused = input.admitLifetimeHunt();
        if (refused !== null) return refused;
        await register();
        // Ignore only the discretionary combined request count. The shared
        // transaction still applies host spacing, concurrency, backoff and
        // vendor concurrency/backoff to this exact hunt's request.
        const at = input.now();
        const outcome = await input.repos.budget.mutate((original) => {
          const ledger = recoverSearchSlots(original, at);
          const vendor = ledger.vendors[DISCOVERY_SEARCH_VENDOR];
          if (!vendor) return { ledger, result: "search vendor budget is missing" };
          const transient: BudgetLedger = { ...ledger, vendors: { ...ledger.vendors,
            [DISCOVERY_SEARCH_VENDOR]: { ...vendor, dailyRequestCap: null } } };
          const acquired = tryAcquire(transient, host, at);
          return { ledger: { ...acquired.ledger, vendors: ledger.vendors },
            result: acquired.granted ? null : acquired.reason };
        }, at);
        if (outcome.result !== null) return outcome.result;
        remember(host, at);
        used += 1;
        return null;
      },
      done,
    },
  };
}

/** Lowercase host + path, for de-duplicating results across providers. */
function dedupeKey(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * The executor's search seam, or null when no provider key is configured. A
 * domain restriction is expressed per provider: Brave's `site:` operator, and
 * Exa's `includeDomains`.
 */
export function makeDiscoverySearch(options: {
  readonly braveKey?: string | null;
  readonly exaKey?: string | null;
  readonly budget: SearchBudget;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly perProvider?: number;
  readonly maxHits?: number;
}): DiscoverySearch | null {
  const braveKey = options.braveKey?.trim() || null;
  const exaKey = options.exaKey?.trim() || null;
  if (braveKey === null && exaKey === null) return null;
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);
  const timeoutMs = Math.min(options.timeoutMs ?? 8_000, SEARCH_REQUEST_LIFETIME_MS / 2);
  const perProvider = options.perProvider ?? 5;
  const maxHits = options.maxHits ?? 8;

  const run: DiscoverySearch = async ({ query, ownSiteDomain }) => {
    const requests: SearchRequestRecord[] = [];
    const lists: SearchHit[][] = [];
    const providers: { provider: "brave" | "exa"; key: string; host: string; run: () => Promise<{ hits: SearchHit[]; bytes: number }> }[] = [];
    if (braveKey !== null) {
      providers.push({
        provider: "brave", key: braveKey, host: SEARCH_HOSTS.brave,
        run: () => braveSearch(ownSiteDomain === null ? query : `${query} site:${ownSiteDomain}`, braveKey, fetchImpl, timeoutMs, perProvider),
      });
    }
    if (exaKey !== null) {
      providers.push({
        provider: "exa", key: exaKey, host: SEARCH_HOSTS.exa,
        run: () => exaSearch(query, exaKey, fetchImpl, timeoutMs, perProvider, ownSiteDomain === null ? undefined : [ownSiteDomain]),
      });
    }
    for (const p of providers) {
      const refused = await options.budget.take(p.host);
      if (refused !== null) {
        requests.push({ provider: p.provider, status: "BUDGET_REFUSED", error: refused, bytes: 0, hitCount: 0 });
        continue;
      }
      try {
        const got = await p.run();
        requests.push({ provider: p.provider, status: "DELIVERED", error: null, bytes: got.bytes, hitCount: got.hits.length });
        lists.push(got.hits);
      } catch (error) {
        requests.push({ provider: p.provider, status: "FAILED", error: (error instanceof Error ? error.message : String(error)).slice(0, 200), bytes: 0, hitCount: 0 });
      } finally {
        await options.budget.done(p.host);
      }
    }
    /* Interleave the providers' results so neither dominates, then de-duplicate. */
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (let rank = 0; hits.length < maxHits; rank += 1) {
      let advanced = false;
      for (const list of lists) {
        if (rank >= list.length) continue;
        advanced = true;
        const key = dedupeKey(list[rank].url);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(list[rank]);
        if (hits.length >= maxHits) break;
      }
      if (!advanced) break;
    }
    return { hits, requests };
  };
  /* One query sends each provider one request in turn, each at most timeoutMs; the budget ledger's calls take the rest. */
  const providerCount = (braveKey === null ? 0 : 1) + (exaKey === null ? 0 : 1);
  return Object.assign(run, { worstCaseMs: providerCount * timeoutMs + SEARCH_LEDGER_ALLOWANCE_MS });
}
