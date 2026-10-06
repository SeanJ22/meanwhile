/**
 * **THE OBLIGATION-PROVIDER REGISTRY.**
 * (Session C, PART D1, 2026-08-31.)
 *
 * ## The defect this closes, stated as it was found
 *
 * `scripts/freshness-shadow.mts` imported `freshnessObligationsFromMeetings`,
 * built its ENTIRE corpus from the meetings snapshot, and built its route map
 * from `data/meetings-snapshot.json`. So the unattended loop could only ever
 * hunt meetings. Meanwhile `arizonaLocalObligation()` in
 * `lib/control-plane/campaign-finance/obligations.ts` was invoked by its own
 * definition, by `campaignFinanceObligations()`, and by its test — and by
 * NOTHING OPERATIONAL. **A domain obligation reachable only from tests is a
 * failure**, because the tests agree with it by construction and the machine
 * never runs it.
 *
 * The fix is not "add campaign finance to the runner". It is to make the
 * runner's input a REGISTRY of obligation providers, of which meetings is one
 * and campaign finance is the second, so that a third domain is a new file in
 * `providers/` rather than an edit to the loop.
 *
 * ## The interface is justified by TWO CONCRETE PROVIDERS, and no more
 *
 * RULING 214: multi-project abstraction is built at the SECOND project, not in
 * anticipation of one. Every member below exists because one of the two real
 * providers needs it and the other one shows it cannot be assumed away:
 *
 * ```
 *   id                  the digest states the split per provider, and a
 *                       provider that yielded nothing must be nameable
 *   enumerate()         meetings derives obligations from a committed
 *                       snapshot; campaign finance derives them from a
 *                       jurisdiction/record model. Neither can be expressed as
 *                       the other, so enumeration is the provider's
 *   routes              meetings has exactly ONE representation per body (the
 *                       calendar URL its provenance recorded). Campaign
 *                       finance has SEVERAL per record — a DataTables POST, a
 *                       bulk FTP drop, a county portal — and RULING 207 says
 *                       one 200 never retires the others. So a route is a
 *                       PORTFOLIO on the record, never a URL on the obligation
 *   executorClass       meetings is an HTTP GET, which is deterministic.
 *                       Campaign finance carries an FTP drop no HTTP client
 *                       can open and a portal whose shape is not yet derived.
 *                       The class therefore cannot be a property of the loop
 *   scheduledId         meetings obligations are ALREADY DURABLE under
 *                       `freshness:meetings:<subject>`. A registry that
 *                       renamed them would orphan every stored next-due,
 *                       occurrence count and debt row, so identity is the
 *                       provider's to state and never the registry's to guess
 * ```
 *
 * There is no `priority`, no `tags`, no `capabilities`, no plugin lifecycle and
 * no dynamic registration, because neither provider needs one.
 *
 * ## The scheduled unit is (RECORD × REPRESENTATION), and that is RULING 207
 *
 * `FreshnessObligation` carries ONE `routeId`, and `openOccurrence` opens ONE
 * RouteTask against it. That is not a limitation to work around — it is the
 * right granularity, once the record and the representation are separated:
 *
 * ```
 *   ProvidedObligation   the RECORD this project owes a fresh reading of
 *        |                (a body's calendar; Arizona's 2026 filer index)
 *        +-- route 1  ->  one FreshnessObligation, one occurrence, one
 *        +-- route 2  ->  RouteTask, one Attempt, one disposition, its own
 *        +-- route 3  ->  debt and its own next_due
 * ```
 *
 * Each representation therefore gets the FULL lifecycle independently. A wall
 * on the FTP drop accrues debt against the FTP drop and does not touch the
 * DataTables route's clock, and a 200 from one never marks the others worked —
 * which is exactly what "ONE ROUTE SUCCESS != SOURCE UNIVERSE COMPLETE"
 * requires of a scheduler rather than of a report about one.
 *
 * ## What a provider may NOT do
 *
 * Invent an obligation. Every row a provider returns is derived from something
 * committed — a snapshot, a ballot, a filing regime, a handoff file — and a
 * provider that reads nothing returns nothing and SAYS SO. The registry
 * distinguishes "this provider found no rows" from "this provider could not
 * read its input", because a zero-row extraction is a FAILED extraction and
 * may never be reported as an empty domain.
 */

import type { ExecutorKind } from "./dispatch.ts";
import type { FreshnessObligation } from "./obligation.ts";
import type { AutonomousWorkPlan } from "../workers/autonomous-plan.ts";
import { routeWorkPlan } from "../workers/route-plan.ts";

/* ------------------------------------------------------------------ routes */

/**
 * How a route is OPENED, as far as an unattended executor is concerned.
 *
 * Three kinds, and each one exists because a real registered route needs it:
 * the meetings calendars and the Pima portal are GETs, the New Hampshire CFS
 * API and the Arizona SeeTheMoney DataTables action are POSTs whose bodies ARE
 * their schemas, and `ftp://ftp.azsos.gov/cfsdata2/` is reachable by neither.
 *
 * `NOT_MACHINE_EXECUTABLE` is not a disposal and not an absence. It is the
 * honest statement that THIS process holds no client for this representation,
 * which is a fact about our tooling — `REQUIRES_NEW_ADAPTER` — and never a fact
 * about the record.
 */
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
  /*
   * **CARRIED BY A ROUTINE READ, NEVER OPENED HERE.** (2026-09-25.) The record
   * is read by routine civic-data contracts on their own clocks (the one clock
   * per source, RULING 282/283), so this process sends nothing: opening the
   * same feed here would be a second clock beside the partition. The
   * obligation records that the record is still owed, which contracts carry
   * it and when their next read is owed; `cadenceFailure` names a carrying read
   * that has not succeeded within its required cadence. Executor class:
   * DETERMINISTIC, and no model is ever spent on it.
   */
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

/**
 * **WHAT A SUCCESSFUL RESPONSE FROM THIS ROUTE MUST CONTAIN.**
 *
 * This exists because of a measured failure mode, not a hypothetical one:
 * `POST seethemoney.az.gov/Reporting/GetNEWTableData` answered **HTTP 200 with
 * a two-byte empty JSON string** to every guessed body between 2026-08-24 and
 * 2026-08-31. A 200 with bytes is INGESTED under the plain HTTP mapping, so an
 * executor with no yield contract would have written a terminal INGESTED
 * disposition, recorded a two-byte artifact as the state's filer index,
 * cleared the obligation's debt and moved its next-due. **That is a wrong
 * answer about a government, produced by arithmetic.**
 *
 * So a route may declare what its own success looks like, and the executor
 * checks the bytes against it before any disposition is written. A response
 * that misses the contract is a FAILED extraction — never an empty document,
 * and never a reading of the publisher.
 *
 * Expressed declaratively rather than as a predicate function, so a lane can
 * ship one in a JSON descriptor file without shipping code.
 */
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

/**
 * ONE REPRESENTATION of a record, and everything the loop needs to work it.
 *
 * `routeId` is the join to the method store, which is what `chooseExecutor`
 * reads to decide GRADUATED or UNGRADUATED. A descriptor whose `routeId` is
 * absent from `data/method/knowledge.json` is not broken — it dispatches to the
 * bounded lane, which is the honest reading of "we have not learned this".
 */
export interface RouteDescriptor {
  readonly routeId: string;
  readonly label: string;
  /**
   * The executor class this representation genuinely needs.
   *
   * Declared by the provider because only the provider knows whether the shape
   * is derived. A model may not be spent re-deriving a request body we have
   * already written down, and deterministic code may not be pointed at a
   * surface nobody has read.
   */
  readonly executorClass: ExecutorKind;
  /** Why that class, in one sentence a digest can quote. */
  readonly executorReason: string;
  readonly open: RouteOpening;
  /**
   * What a genuine yield from this route looks like. Optional, and its absence
   * means the executor falls back to "2xx with bytes", which is only safe for
   * a route that has never been observed answering 200 with nothing.
   */
  readonly yieldContract?: YieldContract;
  /**
   * The evidence that this route is real, cited to a file or a walk date.
   * Never a claim, always a citation — a route descriptor with no provenance
   * is a guess with a schedule attached.
   */
  readonly citation: string;
  /**
   * Set when the descriptor is a PLACEHOLDER awaiting a real adapter.
   *
   * The Arizona SeeTheMoney descriptor is registered on the parameter shape a
   * prior session measured; the adapter that reads its rows is another lane's.
   * The route still schedules, still opens, still disposes and still accrues
   * debt — it simply says out loud that its yield is not yet parsed.
   */
  readonly awaitingAdapter?: string;
}

/* ----------------------------------------------------------- the obligation */

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
  /**
   * Every material representation. At least one, and MORE than one is the
   * normal case for anything a vendor serves.
   */
  readonly routes: readonly RouteDescriptor[];
  /**
   * CH-22: the work plan a route's paid work carries, by route id, so its findings go through the
   * coordinator and the builders to a reader door, the way a Send's do. A route with none stays as it was.
   */
  readonly autonomousPlans?: Readonly<Record<string, AutonomousWorkPlan>>;
}

/** What a provider was given to read. No clock is read inside a provider. */
export interface ProviderContext {
  readonly root: string;
  readonly nowIso: string;
  /** CH-23 part 2 (WTP_ONE_HUNTER_PATH): every paid route no provider planned gets a route plan, so its Scout is coordinator work. */
  readonly planEveryPaidRoute?: boolean;
}

/**
 * What a provider produced, INCLUDING whether it could read its input.
 *
 * `readFailure` is the field that keeps a broken input from reading as an empty
 * domain. A provider whose snapshot is missing returns zero rows AND names the
 * failure; the registry surfaces both, and the digest prints the reason rather
 * than a silent zero.
 */
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
  /**
   * The durable id for one (record, representation) pair.
   *
   * The provider's, not the registry's: meetings rows are already stored under
   * `freshness:meetings:<subject>` and renaming them would orphan every
   * next-due, occurrence count and debt row the control plane holds.
   */
  scheduledId(record: ProvidedObligation, route: RouteDescriptor): string;
}

/* -------------------------------------------------------------- the registry */

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

/**
 * Run every provider and flatten to the units the scheduler works.
 *
 * A provider that THROWS is not allowed to take the registry down with it: its
 * failure is recorded as a `readFailure` against that provider alone and every
 * other provider's obligations still schedule. One blocked domain never
 * freezes the rest of the hunt.
 */
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
              : ctx.planEveryPaidRoute ? withPlan(routeWorkPlan({ providerId: provider.id, record, route })) : {}),
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

/**
 * The registry's lines for a digest.
 *
 * Every provider is named whether or not it yielded, and a read failure prints
 * as a failure rather than as a zero. A registry that only listed the providers
 * that produced rows would report a broken domain as an absent one.
 */
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
