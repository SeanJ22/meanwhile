/**
 * The obligation-provider registry. Each provider enumerates the records it keeps fresh from committed data,
 * with a portfolio of routes; each (record, representation) pair is its own scheduled unit with its own
 * lifecycle, debt and next-due, so one route's success never marks another worked. A provider never invents an
 * obligation, and one that could not read its input says so rather than reporting an empty domain.
 */

import type { ExecutorKind } from "./dispatch.ts";
import type { FreshnessObligation } from "./obligation.ts";
import type { AutonomousWorkPlan } from "../workers/autonomous-plan.ts";
import { routeWorkPlan } from "../workers/route-plan.ts";


/** How an unattended executor opens a route. `NOT_MACHINE_EXECUTABLE` is a fact about our tooling (REQUIRES_NEW_ADAPTER), never about the record. */
export type RouteOpening =
  | { readonly kind: "HTTP_GET"; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
  | {
      readonly kind: "HTTP_POST";
      readonly url: string;
      readonly contentType: string;
      readonly body: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | { readonly kind: "NOT_MACHINE_EXECUTABLE"; readonly reason: string; readonly target: string }
  /* Carried by routine civic-data contracts on their own clocks, so nothing is sent here. DETERMINISTIC; never spends a model. */
  | {
      readonly kind: "ROUTINE_READ";
      /** The routine contract ids whose reads close it. At least one. */
      readonly contractIds: readonly string[];
      readonly target: string;
      /** Where the carrying reads stood when the provider read them, in one paragraph a digest can quote. */
      readonly reason: string;
      /** Non-null when a carrying read has not succeeded within its required cadence: the named failure. */
      readonly cadenceFailure: string | null;
    };

/** What a successful response from this route must contain, checked before any disposition; a miss is a failed extraction. Declarative so a descriptor file can carry it. */
export interface YieldContract {
  /** One sentence naming the recognisable shape. Quoted in the disposition. */
  readonly describe: string;
  /** Every one of these substrings must appear in the response body. */
  readonly requireAll: readonly string[];
  /** Dot path to an ARRAY in the parsed JSON whose length is the row count. */
  readonly rowsAt?: string;
  /** Dot path to an INTEGER row count in the parsed JSON. */
  readonly countAt?: string;
}

/** One representation of a record. `routeId` is the join to the method store; an unknown id dispatches to the bounded lane. */
export interface RouteDescriptor {
  readonly routeId: string;
  readonly label: string;
  /** The executor class this representation needs, declared by the provider. */
  readonly executorClass: ExecutorKind;
  /** Why that class, in one sentence a digest can quote. */
  readonly executorReason: string;
  readonly open: RouteOpening;
  /** What a genuine yield looks like. Absent, the executor accepts any 2xx with bytes. */
  readonly yieldContract?: YieldContract;
  /** The evidence that this route is real, cited to a file or a walk date. */
  readonly citation: string;
  /** Set when the descriptor is a placeholder awaiting a real adapter; the route still schedules and disposes. */
  readonly awaitingAdapter?: string;
}


/** One RECORD a provider keeps fresh, with its whole route portfolio. */
export interface ProvidedObligation {
  /** The record class — "meetings", "campaign-finance". */
  readonly recordClass: string;
  /** The canonical subject: a body id, a jurisdiction-and-cycle key. */
  readonly subjectId: string;
  /** Exact divisions from this record's authority, for shared-work Send attribution. */
  readonly scopeDivisions?: readonly string[];
  readonly readerImpactAt: string | null;
  readonly observedChangeRateHours: number | null;
  readonly declaredCycleHours?: number | null;
  readonly lastWorkedAt: string | null;
  /** Every material representation; at least one. */
  readonly routes: readonly RouteDescriptor[];
  /** The work plan a route's paid work carries, by route id. A route with none stays as it was. */
  readonly autonomousPlans?: Readonly<Record<string, AutonomousWorkPlan>>;
}

/** What a provider was given to read. No clock is read inside a provider. */
export interface ProviderContext {
  readonly root: string;
  readonly nowIso: string;
}

/** What a provider produced, including whether it could read its input. */
export interface ProviderYield {
  readonly obligations: readonly ProvidedObligation[];
  /** Non-null when the provider's own input could not be read. */
  readonly readFailure: string | null;
  /** Non-null when the input WAS read and legitimately holds nothing. */
  readonly emptyReason: string | null;
}

export interface ObligationProvider {
  readonly id: string;
  /** One line for the digest. What this provider is a provider OF. */
  readonly describe: string;
  enumerate(ctx: ProviderContext): ProviderYield;
  /** The durable id for one (record, representation) pair. The provider's, not the registry's, so stored rows are never orphaned. */
  scheduledId(record: ProvidedObligation, route: RouteDescriptor): string;
}


/** One scheduled unit: the obligation the loop schedules, and its route. */
export interface RegisteredUnit {
  readonly providerId: string;
  readonly obligation: FreshnessObligation;
  readonly route: RouteDescriptor;
  readonly record: ProvidedObligation;
}

export interface ProviderReport {
  readonly providerId: string;
  readonly describe: string;
  readonly records: number;
  readonly units: number;
  readonly readFailure: string | null;
  readonly emptyReason: string | null;
}

export interface RegistryPass {
  readonly units: readonly RegisteredUnit[];
  readonly obligations: readonly FreshnessObligation[];
  readonly byProvider: readonly ProviderReport[];
  /** Obligation id → its route descriptor. The loop's whole route lookup. */
  readonly routeFor: (obligationId: string) => RouteDescriptor | null;
  /** Obligation id → the provider that produced it. */
  readonly providerOf: (obligationId: string) => string | null;
}

/** Raised when two providers claim one obligation id. Never reconciled. */
export class ObligationIdCollision extends Error {
  constructor(id: string, first: string, second: string) {
    super(
      `obligation id ${id} was produced by both '${first}' and '${second}'. Two providers cannot ` +
        "own one durable row: whichever wrote last would silently take over the other's next-due, " +
        "occurrence count and debt. Refused rather than reconciled.",
    );
    this.name = "ObligationIdCollision";
  }
}

/** Run every provider and flatten to scheduled units. A provider that throws is recorded as its own `readFailure`; the rest still schedule. */
const withPlan = (plan: AutonomousWorkPlan | null) => plan ? { autonomousPlan: plan } : {};

export function buildRegistry(
  providers: readonly ObligationProvider[],
  ctx: ProviderContext,
): RegistryPass {
  const units: RegisteredUnit[] = [];
  const byProvider: ProviderReport[] = [];
  const owner = new Map<string, string>();
  const routes = new Map<string, RouteDescriptor>();

  for (const provider of providers) {
    let produced: ProviderYield;
    try {
      produced = provider.enumerate(ctx);
    } catch (error) {
      byProvider.push({
        providerId: provider.id,
        describe: provider.describe,
        records: 0,
        units: 0,
        readFailure: `enumeration threw: ${error instanceof Error ? error.message : String(error)}`,
        emptyReason: null,
      });
      continue;
    }

    let count = 0;
    for (const record of produced.obligations) {
      for (const route of record.routes) {
        const id = provider.scheduledId(record, route);
        const existing = owner.get(id);
        if (existing !== undefined && existing !== provider.id) {
          throw new ObligationIdCollision(id, existing, provider.id);
        }
        owner.set(id, provider.id);
        routes.set(id, route);
        units.push({
          providerId: provider.id,
          route,
          record,
          obligation: {
            id,
            recordClass: record.recordClass,
            subjectId: record.subjectId,
            ...(record.scopeDivisions ? { scopeDivisions: [...new Set(record.scopeDivisions)].sort() } : {}),
            routeId: route.routeId,
            active: true,
            readerImpactAt: record.readerImpactAt,
            observedChangeRateHours: record.observedChangeRateHours,
            ...(record.declaredCycleHours !== undefined
              ? { declaredCycleHours: record.declaredCycleHours }
              : {}),
            lastWorkedAt: record.lastWorkedAt,
            ...(record.autonomousPlans?.[route.routeId] ? { autonomousPlan: record.autonomousPlans[route.routeId] }
              : withPlan(routeWorkPlan({ providerId: provider.id, record, route }))),
          },
        });
        count += 1;
      }
    }

    byProvider.push({
      providerId: provider.id,
      describe: provider.describe,
      records: produced.obligations.length,
      units: count,
      readFailure: produced.readFailure,
      emptyReason: produced.emptyReason,
    });
  }

  units.sort((a, b) => (a.obligation.id < b.obligation.id ? -1 : a.obligation.id > b.obligation.id ? 1 : 0));

  return {
    units,
    obligations: units.map((u) => u.obligation),
    byProvider,
    routeFor: (id) => routes.get(id) ?? null,
    providerOf: (id) => owner.get(id) ?? null,
  };
}

/** The registry's digest lines. Every provider is named, and a read failure prints as a failure, not a zero. */
export function registryLines(pass: RegistryPass): string[] {
  const out: string[] = [];
  out.push(
    `  registry           ${pass.byProvider.length} provider(s), ${pass.units.length} scheduled ` +
      "unit(s) — one per (record x representation)",
  );
  for (const p of pass.byProvider) {
    out.push(`      ${p.providerId.padEnd(18)} ${p.records} record(s) -> ${p.units} route unit(s)`);
    if (p.readFailure !== null) {
      out.push(`          READ FAILURE: ${p.readFailure}`);
      out.push(
        "          This is a failure to read OUR input, not evidence that the domain is empty.",
      );
    } else if (p.units === 0) {
      out.push(
        `          NO UNITS: ${p.emptyReason ?? "the provider returned no rows and gave no reason — treat as a defect, not an empty domain"}`,
      );
    }
  }
  return out;
}
