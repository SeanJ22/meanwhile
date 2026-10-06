/**
 * **PROVIDER SIX — MEETINGS DISCOVERY, WHERE THE OWNER SENT THE FLEET.**
 * (MW-028, 2026-09-23. RULING 248, RULING 249, RULING 251.)
 *
 * Every enumerated government's meetings are owed to the reader. Its registry
 * records where they have not been found: its own site is known and unwalked
 * (`SOURCE_DISCOVERY_OWED`), or no site is recorded at all
 * (`NO_MEETINGS_SOURCE_RECORDED`). `lib/hunt/meetings-discovery.ts` derives
 * that list from the promoted jurisdiction registries, and this provider uses
 * the same derivation — the same shapes, never a second list.
 *
 * ## What it schedules
 *
 * Only the needs the owner's dispatch MATERIALIZED (`dispatch-work.ts`): one
 * obligation per government in a geography the owner sent the fleet to, in
 * the registry derivation's shape. The rest stay owed; the mission map's calendar blanks are walked free (CH-21);
 * a dispatch or a selected scope is what turns a need into scheduled work.
 *
 * ```
 *   id          freshness:meetings-discovery:<jurisdiction id>#<route>
 *   route       own-site-meetings   basis SOURCE_DISCOVERY_OWED: walk the
 *                                   government's recorded own site
 *               find-own-site       basis NO_MEETINGS_SOURCE_RECORDED: no site
 *                                   is recorded, so finding it is the first step
 *   subject     the jurisdiction id, as in the registry
 *   class       BOUNDED_MODEL_WORKER with a NOT_MACHINE_EXECUTABLE opening:
 *               discovery, never acquisition
 * ```
 *
 * A consumer maps an obligation back to its need with `meetingsDiscoveryNeedFor`
 * and the jurisdiction id; nothing about the need is re-encoded here.
 *
 * ## Never a second meetings clock
 *
 * A discovery obligation opens nothing a deterministic client can fetch: its
 * route is not machine-executable, so the plain-code lane can only dispose it
 * REQUIRES_NEW_ADAPTER, and a Scout (while the paid lane is open) can only
 * propose a route candidate. Meetings ACQUISITION stays with the production
 * meeting partitions (RULING 282/283), and a discovered route becomes a clock
 * only by being wired there.
 */

import type { JurisdictionRegistry } from "../../../hunt/jurisdiction-universe.ts";
import {
  meetingsDiscoveryNeeds,
  OWN_SITE_MEETINGS_SOURCE,
  type DiscoveryAddressSource,
  type MeetingsDiscoveryBasis,
  type MeetingsDiscoveryNeed,
} from "../../../hunt/meetings-discovery.ts";
import { requiredJurisdictionRegistry } from "../../../civic-data/operational-references.ts";
import { NOTHING_MATERIALIZED, type FreeDiscoveryWalks, type MaterializedReading } from "../provider-inputs.ts";
import type { ObligationProvider, ProvidedObligation, ProviderContext, ProviderYield, RouteDescriptor } from "../registry.ts";

export const MEETINGS_DISCOVERY_PROVIDER_ID = "meetings-discovery";

/** Every id this provider owns starts with this. */
export const MEETINGS_DISCOVERY_NAMESPACE = "freshness:meetings-discovery:";

/** The record class these obligations carry. */
export const MEETINGS_DISCOVERY_RECORD_CLASS = "meetings-discovery";

/** The route each basis is worked through. Stable: part of the durable id. */
export const MEETINGS_DISCOVERY_ROUTE: Readonly<Record<MeetingsDiscoveryBasis, string>> = {
  SOURCE_DISCOVERY_OWED: "own-site-meetings",
  NO_MEETINGS_SOURCE_RECORDED: "find-own-site",
};

/** The durable obligation id for one need. */
export function meetingsDiscoveryObligationId(need: Pick<MeetingsDiscoveryNeed, "jurisdictionId" | "basis">): string {
  return `${MEETINGS_DISCOVERY_NAMESPACE}${need.jurisdictionId}#${MEETINGS_DISCOVERY_ROUTE[need.basis]}`;
}

/** The jurisdiction and route an id names, or null for any other id. */
export function parseMeetingsDiscoveryId(id: string): { readonly jurisdictionId: string; readonly routeId: string } | null {
  if (!id.startsWith(MEETINGS_DISCOVERY_NAMESPACE)) return null;
  const rest = id.slice(MEETINGS_DISCOVERY_NAMESPACE.length);
  const hash = rest.indexOf("#");
  if (hash <= 0 || hash === rest.length - 1) return null;
  return { jurisdictionId: rest.slice(0, hash), routeId: rest.slice(hash + 1) };
}

/** The need one registry records for one government, or null. */
export function meetingsDiscoveryNeedFor(reg: JurisdictionRegistry, jurisdictionId: string): MeetingsDiscoveryNeed | null {
  return meetingsDiscoveryNeeds([reg]).find((n) => n.jurisdictionId === jurisdictionId) ?? null;
}

/** The route one need is worked through: discovery, never an openable address. */
export function meetingsDiscoveryRoute(reg: JurisdictionRegistry, need: MeetingsDiscoveryNeed): RouteDescriptor {
  const routeId = MEETINGS_DISCOVERY_ROUTE[need.basis];
  const ownSite = need.basis === "SOURCE_DISCOVERY_OWED";
  const source = ownSite ? reg.sourceCatalog[need.sources[0] ?? OWN_SITE_MEETINGS_SOURCE] ?? null : null;
  return {
    routeId,
    label: `${need.name} — meetings discovery (${ownSite ? "its own recorded site" : "no site recorded yet"})`,
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason:
      "finding where a government publishes its meetings is discovery: the address or the extraction is not " +
      "known, so no deterministic client may be pointed at a guess",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: need.ownWebAddress ?? need.name,
      reason: ownSite
        ? `${source?.owed ?? "walk the government's own recorded site for its meetings"} ` +
          "REQUIRES_NEW_ADAPTER: this is a fact about our tooling and our reading, never about the record."
        : "no website is recorded for this government, so its meetings have no source yet. The first step is " +
          "its own site (RULING 249, Tier B), found from what the tier above publishes about it; an absence is " +
          "argued, never asserted (RULING 250). REQUIRES_NEW_ADAPTER: a fact about our reading, never about the record.",
    },
    citation:
      source?.citation ??
      (reg.registration === undefined
        ? `the promoted ${need.stateCode} jurisdiction registry names this government and records no MEETINGS source for it (basis NO_MEETINGS_SOURCE_RECORDED)`
        : `${need.stateCode.toUpperCase()}'s registration names this government (promoted version ${reg.registration.versionId}), and the Census records no web address for it, so none is invented (basis NO_MEETINGS_SOURCE_RECORDED)`),
    awaitingAdapter: "the meetings discovery executor",
  };
}

/**
 * **REUSE THE FREE WALK WITHOUT REQUIRING IT FIRST.** (2026-09-26.)
 *
 * A meetings-discovery obligation is model-class, so it would otherwise go to
 * the paid Scout lane whenever that lane is open. The unpaid discovery
 * executor walks the same governments first — the ones the owner's dispatch
 * materialized, then the mission map's calendar blanks (CH-21) — and the paid lane may never
 * re-walk an already confirmed route. An unattempted free walk is not a paid
 * admission prerequisite: the owner permits an appropriate paid route early,
 * within the existing authorization and token reservations. An unread log holds,
 * so a failed read never opens the paid lane.
 *
 * Returns null for any other obligation, and for one the paid lane may take.
 */
export const FREE_WALK_FIRST = "FREE_WALK_FIRST";

export function paidDiscoveryHold(
  obligationId: string,
  walks: FreeDiscoveryWalks,
): { readonly code: typeof FREE_WALK_FIRST; readonly why: string } | null {
  const parsed = parseMeetingsDiscoveryId(obligationId);
  if (parsed === null) return null;
  const outcome = walks.latestFor(parsed.jurisdictionId);
  if (outcome === "WALKED_NOT_FOUND" || outcome === "NO_SITE_TO_WALK" || outcome === "NOT_WALKED") return null;
  const why =
    outcome === "FOUND"
      ? "the free discovery walk already found this government's meetings, and the paid lane never re-walks what the free lane read"
      : `the free discovery walk's record could not be read (${walks.source}), so the paid lane waits rather than risk re-walking what the free lane read`;
  return { code: FREE_WALK_FIRST, why };
}

/**
 * The needs the owner's dispatch materialized, each with the promoted registry
 * it derives from. There is one registry reading per state, by the gap
 * ledger's own derivation (`meetingsDiscoveryNeeds`), never a second list.
 *
 * The provider emits its obligations from these. The runner hands the same
 * needs to the free walk, which goes first on dispatched governments. The
 * committed ledger the walk otherwise reads is a snapshot that may not hold
 * them, for example a state promoted after it was built.
 *
 * An id is left out when the registry no longer records its government, or
 * when its basis moved: the row leaves the corpus and its provider's
 * retirement judges it. A state whose registry cannot be read is named, and
 * none of its governments are guessed at.
 */
export function materializedDiscoveryNeeds(
  ids: Iterable<string>,
  registryFor: (stateCode: string) => JurisdictionRegistry = requiredJurisdictionRegistry,
): {
  readonly entries: readonly { readonly need: MeetingsDiscoveryNeed; readonly reg: JurisdictionRegistry }[];
  readonly failures: readonly string[];
} {
  const entries: { need: MeetingsDiscoveryNeed; reg: JurisdictionRegistry }[] = [];
  const failures: string[] = [];
  const needsByState = new Map<string, { readonly reg: JurisdictionRegistry; readonly needs: Map<string, MeetingsDiscoveryNeed> } | null>();
  for (const id of [...ids].sort()) {
    const parsed = parseMeetingsDiscoveryId(id);
    if (parsed === null) continue;
    const stateCode = parsed.jurisdictionId.split(":")[0]?.toLowerCase() ?? "";
    let held = needsByState.get(stateCode);
    if (held === undefined) {
      try {
        const reg = registryFor(stateCode);
        held = { reg, needs: new Map(meetingsDiscoveryNeeds([reg]).map((n) => [n.jurisdictionId, n])) };
      } catch (error) {
        failures.push(
          `the ${stateCode.toUpperCase()} jurisdiction registry could not be read for its materialized meetings discovery ` +
            `(${error instanceof Error ? error.message : String(error)})`,
        );
        held = null;
      }
      needsByState.set(stateCode, held);
    }
    if (held === null) continue;
    const need = held.needs.get(parsed.jurisdictionId);
    if (need === undefined || MEETINGS_DISCOVERY_ROUTE[need.basis] !== parsed.routeId) continue;
    entries.push({ need, reg: held.reg });
  }
  return { entries, failures };
}

/**
 * Where a dispatched need's address was recorded, so a route the walk finds from it can be attested (NH330): the
 * promoted reviewed reference, or — for a state with no reviewed registry — its registration (2026-09-25).
 */
export function dispatchedAddressSource(reg: JurisdictionRegistry, reviewedVersionId: string | null): DiscoveryAddressSource {
  return reg.registration === undefined
    ? { source: "OPERATIONAL_REFERENCE", versionId: reviewedVersionId }
    : { source: "REGISTRATION", versionId: reg.registration.versionId };
}

export interface MeetingsDiscoveryInput {
  readonly materialized?: () => MaterializedReading;
}

export function meetingsDiscoveryProvider(input: MeetingsDiscoveryInput = {}): ObligationProvider {
  const readMaterialized = input.materialized ?? (() => NOTHING_MATERIALIZED);
  return {
    id: MEETINGS_DISCOVERY_PROVIDER_ID,
    describe:
      "meetings discovery the owner's dispatch materialized, one per government in a geography the fleet was sent " +
      "to; the mission map's calendar blanks are walked free without a dispatch (CH-21)",

    /* The template `meetingsDiscoveryObligationId` restates; the assignment view's prefix table reads it here. */
    scheduledId: (record, route) => `freshness:meetings-discovery:${record.subjectId}#${route.routeId}`,

    enumerate(_ctx: ProviderContext): ProviderYield {
      const failures: string[] = [];
      const records: ProvidedObligation[] = [];
      const materialized = readMaterialized();
      if ("unreadable" in materialized) {
        return {
          obligations: [],
          readFailure: `the work the owner's dispatch materialized could not be read (${materialized.unreadable})`,
          emptyReason: null,
        };
      }
      const derived = materializedDiscoveryNeeds(materialized.ids);
      failures.push(...derived.failures);
      for (const { need, reg } of derived.entries) {
        records.push({
          recordClass: MEETINGS_DISCOVERY_RECORD_CLASS,
          subjectId: need.jurisdictionId,
          readerImpactAt: null,
          observedChangeRateHours: null,
          lastWorkedAt: null,
          routes: [meetingsDiscoveryRoute(reg, need)],
        });
      }
      return {
        obligations: records,
        readFailure: failures.length === 0 ? null : failures.join("; "),
        emptyReason:
          records.length === 0 && failures.length === 0
            ? "the owner's dispatch has materialized no meetings discovery yet. A Send's calendar blanks are walked free " +
              "from its mission map; sending the fleet to a geography creates them here"
            : null,
      };
    },
  };
}
