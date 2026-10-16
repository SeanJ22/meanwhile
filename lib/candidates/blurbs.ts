import { getCandidateCorpus } from "./positions.ts";
import type { CandidateDocument } from "./corpus.ts";

export interface DerivedBlurb {
  text: string;
  sourceUrl: string;
  sourceLabel: string;
  basis: CandidateDocument["basis"];
}


const UNUSABLE_CAPTURED_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "73db6c3ad8e2b48990c36e7ef2e423c03f5353798308432b2685fb7fd1d14505": "The Attorney General description ends mid-sentence.",
  "dc455aac3bd696630dbf2344997e7fe1848be52fb8c46fa32cfd6fc34787e090": "The legislative description ends inside a word.",
  "7f80a1f73dcee52336c83d7bbde410449d3458a2d209d2f4fca4f518420cf768": "The description is a newsletter control, not a candidate biography.",
  "a5a4397d781a1f84977ec1531b5d09c2173cbcab59b4ad704837c7ce31b03742": "The description is a newsletter control, not a candidate biography.",
  "9566bb0b9239975471b595e2cf1d4cf68df8bfca7cfdecf2482fbed67fcc5d46": "The description asks for a vote in the 2021 election, not the current cycle.",
  "03fa22b2a3d43c237b3e584e57164ea25c669ef110b604d4fb96658f12c392b4": "The description is repeated office-site navigation and news copy.",
  "85be3bb1f0fe18e4a9583c722efda73233afed6608c8bb6f7e8bb6878da77716": "The description is repeated office-site navigation and news copy.",
};

export function candidateDescriptionQualityIssue(doc: Pick<CandidateDocument, "contentHash">): string | null {
  return UNUSABLE_CAPTURED_DESCRIPTIONS[doc.contentHash] ?? null;
}

function rank(doc: CandidateDocument): number {
  const site = doc.sourceClass === "CAMPAIGN_SITE" ? 0 : 2;
  const basis = doc.basis === "HUNTED_AND_VERIFIED" ? 0 : 1;
  return site + basis;
}

export function derivedBlurbFor(candidateKey: string): DerivedBlurb | null {
  const candidates = getCandidateCorpus()
    .documents.filter((d) => d.candidateKey === candidateKey && d.metaDescription && !candidateDescriptionQualityIssue(d))
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      // Newest retrieval wins within a tie — a campaign rewrites its line.
      return a.retrievedAt < b.retrievedAt ? 1 : -1;
    });
  const doc = candidates[0];
  if (!doc?.metaDescription) return null;

  const host = (() => {
    try {
      return new URL(doc.documentUrl).hostname.replace(/^www\./, "");
    } catch {
      return doc.documentUrl;
    }
  })();
  const read = doc.retrievedAt.slice(0, 10);
  return {
    text: doc.metaDescription,
    sourceUrl: doc.documentUrl,
    sourceLabel:
      doc.sourceClass === "CAMPAIGN_SITE"
        ? `In the campaign's words — ${host}, read ${read}`
        : `In the office's own words — ${host}, read ${read}`,
    basis: doc.basis,
  };
}
