import { readDerivedCampaignSites } from "../civic-data/derived-campaign-sites.ts";
import { lowestZipByDivision } from "../geo/zip-division-index.ts";
import { campaignSiteSubjectsFromHoldings } from "./promotion/campaign-site-cycle.ts";
import { candidateEnrichmentHoldings, preloadCandidateEnrichmentAuthorities } from "./scheduler/providers/candidate-enrichment.ts";
import { collectServedReader } from "./served-reader-collector.ts";
import type { ServedReaderReadback } from "./served-reader.ts";

export async function collectPublishedCampaignReadback(now: string): Promise<ServedReaderReadback> {
  await preloadCandidateEnrichmentAuthorities();
  const derived = await readDerivedCampaignSites();
  const holdings = candidateEnrichmentHoldings();
  if (derived.kind !== "PROMOTED" || !holdings) return { checkedAt: now, witnesses: [], errors: [`Campaign publication readback unavailable: ${derived.kind}.`] };
  const { subjects } = campaignSiteSubjectsFromHoldings(holdings, now);
  const destinations = new Map<string, string>();
  for (const record of derived.value.records) {
    const subject = subjects.get(record.candidacyId);
    if (!subject) continue;
    const zip = (await lowestZipByDivision(subject.stateCode))?.get(subject.ocdId);
    if (zip) destinations.set(record.candidacyId, `https://meanwhileusa.com/ballot?zip=${zip}`);
  }
  // Ordinary public reads, bounded across the pass. No model, search, publication or work admission.
  const signal = AbortSignal.timeout(30_000);
  return collectServedReader({ records: derived.value.records, versionId: derived.projection.versionId, destinations, now,
    read: async url => {
      const response = await fetch(url, { signal, redirect: "error", headers: { "user-agent": "Meanwhile-publication-readback/1" } });
      return { status: response.status, html: await response.text() };
    } });
}
