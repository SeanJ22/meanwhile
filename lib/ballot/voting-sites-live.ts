import { readGoogleVotingAnswer } from "../sources/google-civic/reader-lookup.ts";
import type { CivicReadOptions } from "../sources/google-civic/acquisition.ts";
import type { VotingReaderPlace } from "./voting-answer.ts";
import { modelSentence, narrowingFor, type VotingSitesAnswer } from "./voting-sites.ts";

/** Held locations always win. Google answers live only for this request and in the open panel. */
export async function fillVotingSitesAnswer(held: VotingSitesAnswer, address: string, place: VotingReaderPlace, options: CivicReadOptions = {}): Promise<VotingSitesAnswer> {
  if (!held.outsideCoverage) return held;
  const jurisdictions = await readGoogleVotingAnswer(address, place, options);
  return { ...held, match: held.match || jurisdictions.length > 0, jurisdictions: [...held.jurisdictions, ...jurisdictions.map(j => ({ ...j,
    modelSentence: modelSentence(j), refusalLine: null,
    narrowing: place.precision === "ZIP" ? { kind: "REFUSED" as const,
      sentence: "A ZIP can cross precincts. A street address can identify your Election Day polling place.", rungs: [] }
      : j.assignedSiteIds?.length === 1 ? { kind: "EXACT" as const, siteId: j.assignedSiteIds[0],
        sentence: `For this address, the Civic Information API lists ${j.sites.find(site => site.id === j.assignedSiteIds![0])!.name} as the Election Day polling place.` }
      : narrowingFor(j),
  }))], outsideCoverage: !jurisdictions.some(j => j.sites.length),
    googleFallback: { available: jurisdictions.length > 0, requested: true },
    expiresAt: new Date(Math.min(Date.now(), ...jurisdictions.map(j => Date.parse(j.collectedAt))) + 24 * 60 * 60 * 1000).toISOString() };
}
