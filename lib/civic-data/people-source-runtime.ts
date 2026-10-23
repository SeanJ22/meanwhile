import type { OfficeholderSet } from "../officials/types.ts";
import { acquirePeopleSource } from "../sources/people/acquisition.ts";
import { acquirePresidentPeople, ADMINISTRATION_URL } from "../sources/white-house/president.ts";
import { readPeopleSourceProjection } from "./people-source-read.ts";
import { acquireStatewidePeople } from "../sources/statewide/acquisition.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { peopleSourceContractId, PEOPLE_SOURCE_STATES, STANDING_PEOPLE_SOURCE_IDS, type StandingPeopleSourceId } from "./people-source-contracts.ts";
import { publishPeopleSource } from "./people-source-publication.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "./source-acquisition-failure.ts";
import { routineReceiptFields } from "./runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";
import type { RoutineDataStore } from "./store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { StatePeopleAcquisition } from "./state-people-publication.ts";
import { statePeopleDivisions } from "../sources/plural/acquisition.ts";
import type { RegistryDivisionLite } from "../sources/plural/index.ts";
import type { Slice } from "../control-plane/admin-view/promoted-slices.ts";

interface PeopleSourceAcquired {
  readonly state: string;
  readonly releaseId: string;
  readonly roster: OfficeholderSet;
  readonly acquisitions: readonly StatePeopleAcquisition[];
  readonly gaps: readonly { readonly sourceUrl: string; readonly detail: string }[];
  readonly coverage?: unknown;
}

const PEOPLE_SOURCE_FAILURE_ROUTES: Readonly<Record<StandingPeopleSourceId, string>> = {
  "legiscan-api": "https://api.legiscan.com/?op=getSessionList",
  "official-state-people": "https://v3.openstates.org/jurisdictions",
  "statewide-executive-sources": "https://www.nga.org/governors/",
  "congress-api": "https://api.congress.gov/v3/member?currentMember=true&format=json",
  govinfo: "https://api.govinfo.gov/collections/CDIR",
  "wikidata-people": "https://query.wikidata.org/sparql",
};

export function parsePeopleSourceArguments(args: readonly string[]): { state: string; sourceId: StandingPeopleSourceId } {
  const states = args.filter(arg => arg.startsWith("--state="));
  const sources = args.filter(arg => arg.startsWith("--source="));
  if (args.filter(arg => arg === "--promote").length !== 1 || states.length !== 1 || sources.length !== 1 ||
    args.some(arg => arg !== "--promote" && !arg.startsWith("--state=") && !arg.startsWith("--source="))) {
    throw new Error("PEOPLE_SOURCE_EXACT_STATE_AND_SOURCE_REQUIRED");
  }
  const state = states[0]!.slice("--state=".length).toLowerCase();
  const sourceId = sources[0]!.slice("--source=".length);
  if (!PEOPLE_SOURCE_STATES.includes(state) && !(state === "us" && sourceId === "statewide-executive-sources")) throw new Error("PEOPLE_SOURCE_STATE_UNSUPPORTED");
  if (!(STANDING_PEOPLE_SOURCE_IDS as readonly string[]).includes(sourceId)) throw new Error("PEOPLE_SOURCE_UNSUPPORTED");
  return { state, sourceId: sourceId as StandingPeopleSourceId };
}

export interface PeopleSourceRuntimeDependencies {
  readonly now?: () => string;
  readonly readHeld?: (state: string, store: RoutineDataStore, now: string) => Promise<OfficeholderSet | undefined>;
  readonly readDivisions?: (state: string, asOf: string) => Promise<readonly RegistryDivisionLite[] | Slice<RegistryDivisionLite[]>>;
  readonly acquire?: (input: {
    readonly state: string; readonly sourceId: StandingPeopleSourceId; readonly asOf: string;
    readonly signal: AbortSignal; readonly roster?: OfficeholderSet;
    readonly divisions?: readonly RegistryDivisionLite[];
    readonly now?: () => string;
  }) => Promise<PeopleSourceAcquired>;
  readonly publish?: typeof publishPeopleSource;
  readonly writeLine?: (line: string) => void;
}

async function readHeld(state: string, store: RoutineDataStore, now: string): Promise<OfficeholderSet | undefined> {
  const held = state.toLowerCase() === "us" ? await readPeopleSourceProjection("US", "statewide-executive-sources", { store, now, bypassCache: true })
    : await readStatePeopleProjection(`US-${state.toUpperCase()}`, { store, now, bypassCache: true });
  if (held.kind === "STORE_UNREACHABLE") throw new Error("PEOPLE_SOURCE_HELD_STATE_UNAVAILABLE");
  return held.kind === "PROMOTED" || held.kind === "BOOTSTRAP" ? held.value.roster : undefined;
}

/** A source advances its own pointer as soon as its acquired people pass the publication checks. */
export async function runPeopleSourceRefresh(input: {
  readonly state: string; readonly sourceId: StandingPeopleSourceId; readonly store: RoutineDataStore; readonly vault: EvidenceStore;
  readonly signal?: AbortSignal;
}, dependencies: PeopleSourceRuntimeDependencies = {}): Promise<{ readonly succeeded: boolean; readonly coverage?: unknown }> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const writeLine = dependencies.writeLine ?? console.log;
  const contractId = peopleSourceContractId(input.state, input.sourceId);
  const signal = input.signal ?? new AbortController().signal;
  let acquired: PeopleSourceAcquired;
  const geographyGaps: {sourceUrl:string;detail:string}[] = [];
  const publish = (release: PeopleSourceAcquired) => (dependencies.publish ?? publishPeopleSource)({ store: input.store, vault: input.vault,
    state: input.state, sourceId: input.sourceId, contractId, roster: release.roster,
    acquisitions: release.acquisitions, releaseId: release.releaseId, gaps: [...release.gaps,...geographyGaps], now: now(),
  });
  try {
    // State readers never request another state's source partitions.
    const asOf = now().slice(0,10);
    // The held boundary read answers HELD, UNREAD or NOT_PUBLISHED; only HELD supplies divisions, and the others stay standing work.
    const divisionsFrom = (read: readonly RegistryDivisionLite[] | Slice<RegistryDivisionLite[]>): readonly RegistryDivisionLite[] => {
      if (Array.isArray(read)) return read;
      const slice = read as Slice<RegistryDivisionLite[]>;
      if (slice.kind === "HELD") return slice.value;
      geographyGaps.push({sourceUrl:"https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
        detail:`CENSUS_GEOGRAPHY_${slice.kind}:${input.state.toUpperCase()}: ${slice.kind === "UNREAD" ? slice.detail : "The Census district file has not been published to the reader store."} Verified people publish; their division matching remains standing work.`});
      return [];
    };
    const [roster,divisions] = await Promise.all([
      (dependencies.readHeld ?? readHeld)(input.state, input.store, now()),
      ["legiscan-api","official-state-people","wikidata-people"].includes(input.sourceId)
        ? (dependencies.readDivisions ?? statePeopleDivisions)(input.state,asOf).then(divisionsFrom).catch(()=>{
          geographyGaps.push({sourceUrl:"https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
            detail:`STATE_PEOPLE_DIVISIONS_UNAVAILABLE:${input.state}:Held legislative boundaries could not be read. Verified people publish; their division matching remains standing work.`});
          return [];
        }) : Promise.resolve([]),
    ]);
    const options = { state: input.state, sourceId: input.sourceId, asOf, signal, roster, divisions, now };
    acquired = dependencies.acquire ? await dependencies.acquire(options)
      : input.state.toLowerCase() === "us" && input.sourceId === "statewide-executive-sources" ? await acquirePresidentPeople(options)
      : input.sourceId === "statewide-executive-sources"
        ? await acquireStatewidePeople({ ...options, heldPeople: roster })
        : await acquirePeopleSource({ ...options, sourceId: input.sourceId });
    signal.throwIfAborted();
  } catch (error) {
    const failed = await recordRegisteredSourceAcquisitionFailure({ store: input.store, contractId,
      requestedUrl: input.state.toLowerCase() === "us" ? ADMINISTRATION_URL : PEOPLE_SOURCE_FAILURE_ROUTES[input.sourceId], attemptedAt: now(),
      failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", error instanceof Error ? error.message : String(error)),
    });
    writeLine(failed.line);
    return { succeeded: false };
  }
  const publication = await publish(acquired);
  const publishedRoster=(publication.candidate.readModel as {roster:OfficeholderSet}).roster;
  const coverage={sourceCoverage:acquired.coverage??null,peopleHeld:publishedRoster.officeholders.length,
    legislatorsHeld:publishedRoster.officeholders.filter(person=>person.level==="STATE"&&["upper","lower"].includes(person.chamber??"")).length,
    disagreements:publishedRoster.disagreements?.length??0};
  if (acquired.gaps.length || geographyGaps.length) writeLine(`PEOPLE_SOURCE_GAPS=${JSON.stringify({ state: input.state, sourceId: input.sourceId, gaps: [...acquired.gaps,...geographyGaps] })}`);
  writeLine(`PEOPLE_SOURCE_COVERAGE=${JSON.stringify({ state: input.state, sourceId: input.sourceId, coverage })}`);
  writeLine(`RCD_RECEIPT=${JSON.stringify({ source: contractId,
    ...routineReceiptFields(publication.candidate, publication.outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS })}`);
  return { succeeded: Boolean(publication.outcome.promoted || publication.outcome.confirmed), coverage };
}
