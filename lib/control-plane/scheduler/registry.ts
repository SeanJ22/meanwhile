import { planningStateOf } from "./state-planning.ts";

import type { ExecutorKind } from "./dispatch.ts";
import type { FreshnessObligation } from "./obligation.ts";
import type { AutonomousWorkPlan } from "../workers/autonomous-plan.ts";

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

  | {
      readonly kind: "ROUTINE_READ";

      readonly contractIds: readonly string[];
      readonly target: string;

      readonly reason: string;

      readonly cadenceFailure: string | null;
    };

export interface YieldContract {

  readonly describe: string;

  readonly requireAll: readonly string[];

  readonly rowsAt?: string;

  readonly countAt?: string;

  readonly zeroRowsIsMiss?: true;
}

export interface RouteDescriptor {
  readonly routeId: string;
  readonly label: string;

  readonly executorClass: ExecutorKind;

  readonly executorReason: string;
  readonly open: RouteOpening;

  readonly yieldContract?: YieldContract;

  readonly citation: string;

  readonly awaitingAdapter?: string;
}

export interface ProvidedObligation {

  readonly recordClass: string;

  readonly subjectId: string;

  readonly scopeDivisions?: readonly string[];
  readonly readerImpactAt: string | null;
  readonly observedChangeRateHours: number | null;
  readonly declaredCycleHours?: number | null;
  readonly lastWorkedAt: string | null;

  readonly routes: readonly RouteDescriptor[];

  readonly autonomousPlans?: Readonly<Record<string, AutonomousWorkPlan>>;
}

export interface ProviderContext {
  readonly root: string;
  readonly nowIso: string;
  readonly state?: string;
}

export interface ProviderYield {
  readonly obligations: readonly ProvidedObligation[];

  readonly readFailure: string | null;

  readonly emptyReason: string | null;
}

export interface ObligationProvider {
  readonly id: string;

  readonly describe: string;
  enumerate(ctx: ProviderContext): ProviderYield;

  scheduledId(record: ProvidedObligation, route: RouteDescriptor): string;
}

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

  readonly routeFor: (obligationId: string) => RouteDescriptor | null;

  readonly providerOf: (obligationId: string) => string | null;
}

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

    const records=ctx.state?produced.obligations.filter(record=>(planningStateOf(record.subjectId)??"system")===ctx.state):produced.obligations;
    let count = 0;
    for (const record of records) {
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
            ...(record.autonomousPlans?.[route.routeId] ? { autonomousPlan: record.autonomousPlans[route.routeId] } : {}),
          },
        });
        count += 1;
      }
    }

    byProvider.push({
      providerId: provider.id,
      describe: provider.describe,
      records: records.length,
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
