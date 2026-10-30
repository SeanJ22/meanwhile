import { readGoogleVotingAnswer } from "../sources/google-civic/reader-lookup.ts";
import type { CivicReadOptions } from "../sources/google-civic/acquisition.ts";
import type { CivicLookup } from "../sources/google-civic/model.ts";
export { startGoogleVotingLookup } from "../sources/google-civic/reader-lookup.ts";
import type { VotingReaderPlace } from "./voting-answer.ts";
import { hasElectionDaySites, modelSentence, narrowingFor, type VotingSitesAnswer } from "./voting-sites.ts";

/** Held Election Day locations win. Early voting alone leaves Election Day owed.
 * Google answers live only for this request and in the open panel. A bare ZIP never goes to Google;
 * a street Census could not place still does, with held sites matched by its ZIP. */
export async function fillVotingSitesAnswer(held: VotingSitesAnswer, address: string, place: VotingReaderPlace,
  options: CivicReadOptions & { lookup?: Promise<CivicLookup> } = {}): Promise<VotingSitesAnswer> {
  if (/^\d{5}(?:-\d{4})?$/.test(address.trim()) || hasElectionDaySites(held) || held.jurisdictions.some(j => j.publication?.status === "NO_GENERAL_ELECTION")) return held;
  const { jurisdictions, electionOffices, reason } = await readGoogleVotingAnswer(address, place, options);
  const combined = [...held.jurisdictions, ...jurisdictions.map(j => ({ ...j,
    modelSentence: modelSentence(j), refusalLine: null,
    narrowing: j.assignedSiteIds?.length === 1 ? { kind: "EXACT" as const, siteId: j.assignedSiteIds[0],
      sentence: `For this address, the Civic Information API lists ${j.sites.find(site => site.id === j.assignedSiteIds![0])!.name} as the Election Day polling place.` }
      : narrowingFor(j),
  }))];
  return { ...held, match: held.match || jurisdictions.length > 0, jurisdictions: combined,
    outsideCoverage: !combined.some(j => j.sites.length),
    googleFallback: { available: !reason, requested: true, ...(reason ? { reason } : {}) },
    expiresAt: new Date(Math.min(Date.now(), ...jurisdictions.map(j => Date.parse(j.collectedAt)),
      ...electionOffices.flatMap(office => office.sources.map(source => Date.parse(source.checkedAt)))) + 24 * 60 * 60 * 1000).toISOString() };
}
