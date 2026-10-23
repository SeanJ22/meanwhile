import { readGoogleVotingAnswer } from "../sources/google-civic/reader-lookup.ts";
import type { CivicReadOptions } from "../sources/google-civic/acquisition.ts";
import type { VotingReaderPlace } from "./voting-answer.ts";
import { modelSentence, narrowingFor, type VotingSitesAnswer } from "./voting-sites.ts";
import { stateOfficesForStates } from "../reference/state-offices.ts";

function referenceElectionOffices(states: readonly string[]): NonNullable<VotingSitesAnswer["electionOffices"]> {
  return stateOfficesForStates(states).filter(office => office.kind === "ELECTION_OFFICE").map(office => ({
    name: office.office, phone: office.phone, url: office.url,
    source: { publisher: "Federal Election Commission", title: "State election offices", url: office.sourceUrl, checkedAt: office.checkedAt },
  }));
}

/** Held locations always win. Google answers live only for this request and in the open panel. */
export async function fillVotingSitesAnswer(held: VotingSitesAnswer, address: string, place: VotingReaderPlace, options: CivicReadOptions = {}): Promise<VotingSitesAnswer> {
  if (!held.outsideCoverage) return held.jurisdictions.some(j => j.sites.length) ? held
    : { ...held, electionOffices: referenceElectionOffices(place.states) };
  const { jurisdictions, electionOffices, reason } = await readGoogleVotingAnswer(address, place, options);
  const hasSites = jurisdictions.some(j => j.sites.length);
  return { ...held, match: held.match || jurisdictions.length > 0, jurisdictions: [...held.jurisdictions, ...jurisdictions.map(j => ({ ...j,
    modelSentence: modelSentence(j), refusalLine: null,
    narrowing: place.precision === "ZIP" ? { kind: "REFUSED" as const,
      sentence: "A ZIP can cross precincts. A street address can identify your Election Day polling place.", rungs: [] }
      : j.assignedSiteIds?.length === 1 ? { kind: "EXACT" as const, siteId: j.assignedSiteIds[0],
        sentence: `For this address, the Civic Information API lists ${j.sites.find(site => site.id === j.assignedSiteIds![0])!.name} as the Election Day polling place.` }
      : narrowingFor(j),
  }))], outsideCoverage: !hasSites,
    ...(!hasSites ? { electionOffices: electionOffices.length ? electionOffices
      : referenceElectionOffices(place.states) } : {}),
    googleFallback: { available: !reason, requested: true, ...(reason ? { reason } : {}) },
    expiresAt: new Date(Math.min(Date.now(), ...jurisdictions.map(j => Date.parse(j.collectedAt)),
      ...electionOffices.map(office => Date.parse(office.source.checkedAt))) + 24 * 60 * 60 * 1000).toISOString() };
}
