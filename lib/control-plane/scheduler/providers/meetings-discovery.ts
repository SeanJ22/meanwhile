import {governmentStateOf} from '../../../registration/listings.ts';
import {freeGovernmentSources,type FreeGovernmentSource} from '../../../hunt/free-government-sources.ts';
import {stateOfficesForStates} from '../../../reference/state-offices.ts';
import type {HuntSourceScope} from '../../../hunt/own-site-runtime.ts';
/**
 * Free meetings discovery for every registered government with a website. An explicit dispatch adds paid
 * research for unresolved blanks. A found route publishes through the existing crosswalk and meeting partitions.
 *
 *   id     freshness:meetings-discovery:<jurisdiction id>#<route>
 *   route  own-site-meetings (SOURCE_DISCOVERY_OWED) or find-own-site (NO_MEETINGS_SOURCE_RECORDED)
 */

import type { JurisdictionRegistry } from "../../../hunt/jurisdiction-universe.ts";
import {
  meetingsDiscoveryNeeds,
  type DiscoveryAddressSource,
  type MeetingsDiscoveryBasis,
  type MeetingsDiscoveryNeed,
} from "../../../hunt/meetings-discovery.ts";
import { requiredJurisdictionRegistry } from "../../../civic-data/operational-references.ts";
import { NOTHING_MATERIALIZED, promotedRegistries, type MaterializedReading } from "../provider-inputs.ts";
import { siteOrigins } from "../../../hunt/site-origins.ts";
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

/** This government's own site, or an official published directory when its site is blank. */
export function meetingsDiscoveryRoute(reg: JurisdictionRegistry, need: MeetingsDiscoveryNeed): RouteDescriptor {
  return governmentSourceRoute({jurisdictionId:need.jurisdictionId,name:need.name,state:need.stateCode,govClass:need.govClass,
    website:need.ownWebAddress,directorySeeds:stateOfficesForStates([need.stateCode]).map(office=>office.url),
    citation:reg.registration===undefined ? `${reg.stateCode}'s promoted jurisdiction registry` : `${reg.stateCode}'s promoted registration ${reg.registration.versionId}`},MEETINGS_DISCOVERY_ROUTE[need.basis]);
}

export function governmentSourceRoute(source:FreeGovernmentSource,routeId=source.website ? 'own-site-meetings' : 'find-own-site'):RouteDescriptor {
  const url=source.website??source.directorySeeds[0];
  return {routeId,label:`${source.name} — ${source.website?'government sources':'government website directory'}`,
    executorClass:'DETERMINISTIC',executorReason:'Read held national sources first, then this government’s published pages for open checklist blanks',
    open:url?{kind:'HTTP_GET',url}:{kind:'NOT_MACHINE_EXECUTABLE',target:source.name,reason:'No published government website or official directory address is held; the website blank remains owed'},
    citation:source.citation,
    ...(url?{placeHunt:{jurisdictionId:source.jurisdictionId,governmentId:source.governmentId??null,bodyId:source.bodyId??null,name:source.name,state:source.state.toUpperCase(),website:url,
      knownOwnSite:!!source.website,directorySeeds:source.directorySeeds,govClass:source.govClass} as HuntSourceScope}:{})} as RouteDescriptor;
}

/** The needs the owner's dispatch materialized, each with the registry it derives from. A state whose registry cannot be read is named. */
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
    const stateCode = governmentStateOf(parsed.jurisdictionId)??"";
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

/** Where a dispatched need's address was recorded: the promoted reviewed reference, or the state's registration. */
export function dispatchedAddressSource(reg: JurisdictionRegistry, reviewedVersionId: string | null): DiscoveryAddressSource {
  return reg.registration === undefined
    ? { source: "OPERATIONAL_REFERENCE", versionId: reviewedVersionId }
    : { source: "REGISTRATION", versionId: reg.registration.versionId };
}

/** All recorded government sites remain standing discovery, including governments with a calendar already wired. */
export function standingDiscoveryNeeds(reg: JurisdictionRegistry): readonly MeetingsDiscoveryNeed[] {
  const outstanding = new Map(meetingsDiscoveryNeeds([reg]).map(need => [need.jurisdictionId, need]));
  return reg.jurisdictions.flatMap(row => {
    if (siteOrigins(row.ownWebAddress).length === 0) return [];
    const need = outstanding.get(row.id) ?? {
      jurisdictionId: row.id,
      stateCode: row.stateCode,
      name: row.name,
      govClass: row.govClass,
      countyFips: row.countyFips,
      ownWebAddress: row.ownWebAddress,
      basis: "SOURCE_DISCOVERY_OWED" as const,
      sources: row.sourceIds.filter(id => reg.sourceCatalog[id]?.recordClass === "MEETINGS"),
    };
    return [{ ...need, basis: "SOURCE_DISCOVERY_OWED" as const }];
  }).sort((a, b) => a.jurisdictionId.localeCompare(b.jurisdictionId));
}

export interface MeetingsDiscoveryInput {
  readonly background?: (root:string,state:string)=>readonly FreeGovernmentSource[];
  readonly materialized?: () => MaterializedReading;
  /** State-scoped registered holdings; tests may hand in an exact snapshot. */
  readonly registered?: () => ReturnType<typeof promotedRegistries>;
}

export function meetingsDiscoveryProvider(input: MeetingsDiscoveryInput = {}): ObligationProvider {
  const readMaterialized = input.materialized ?? (() => NOTHING_MATERIALIZED);
  const readRegistered = input.registered ?? promotedRegistries;
  return {
    id: MEETINGS_DISCOVERY_PROVIDER_ID,
    describe:
      "Free government-source reads for every state; Admin orders keep their existing paid hunt packets",

    /* The template `meetingsDiscoveryObligationId` restates; the assignment view's prefix table reads it here. */
    scheduledId: (record, route) => `freshness:meetings-discovery:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      const failures: string[] = [];
      const records = new Map<string, ProvidedObligation>();
      const record = (need: MeetingsDiscoveryNeed, route: RouteDescriptor): ProvidedObligation => ({
        recordClass: MEETINGS_DISCOVERY_RECORD_CLASS,
        subjectId: need.jurisdictionId,
        readerImpactAt: null,
        observedChangeRateHours: null,
        lastWorkedAt: null,
        routes: [route],
      });
      const state=(ctx as ProviderContext & {state?:string}).state;
      if(state && /^[a-z]{2}$/i.test(state)){
        try{for(const source of (input.background??freeGovernmentSources)(ctx.root,state)){
          const basis=source.website?'SOURCE_DISCOVERY_OWED':'NO_MEETINGS_SOURCE_RECORDED';
          const need={...source,stateCode:source.state,ownWebAddress:source.website,basis,sources:[]} as MeetingsDiscoveryNeed;
          records.set(meetingsDiscoveryObligationId(need),record(need,governmentSourceRoute(source)));
        }}catch(error){failures.push(`${state.toUpperCase()}'s held national government sources could not be read (${error instanceof Error?error.message:String(error)})`);}
      }
      const registered = readRegistered();
      if ("unreadable" in registered) failures.push(`registered government websites could not be read (${registered.unreadable})`);
      else {
        for (const [registeredState, why] of registered.refused) if(!state || registeredState.toLowerCase()===state.toLowerCase())failures.push(`${registeredState.toUpperCase()}'s registered government websites could not be read (${why})`);
        for (const reg of registered.registries.values()) {
          if(state && reg.stateCode.toLowerCase()!==state.toLowerCase())continue;
          for (const need of standingDiscoveryNeeds(reg)) records.set(meetingsDiscoveryObligationId(need), record(need, meetingsDiscoveryRoute(reg, need)));
        }
      }
      const materialized = readMaterialized();
      if ("unreadable" in materialized) {
        failures.push(`the work the owner's dispatch materialized could not be read (${materialized.unreadable})`);
      } else {
        const derived = materializedDiscoveryNeeds([...materialized.ids].filter(id=>!state || governmentStateOf(parseMeetingsDiscoveryId(id)?.jurisdictionId??'')===state.toLowerCase()));
        failures.push(...derived.failures);
        for (const { need, reg } of derived.entries) records.set(meetingsDiscoveryObligationId(need), record(need, meetingsDiscoveryRoute(reg, need)));
      }
      return {
        obligations: [...records.values()],
        readFailure: failures.length === 0 ? null : failures.join("; "),
        emptyReason:
          records.size === 0 && failures.length === 0
            ? "no registered government website or explicitly dispatched meetings blank is held"
            : null,
      };
    },
  };
}
