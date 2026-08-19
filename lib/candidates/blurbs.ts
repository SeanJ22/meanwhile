import { getCandidateCorpus } from "./positions.ts";
import type { CandidateDocument } from "./corpus.ts";

/**
 * **A sourced one-line description for every candidate** — tracker **B14**,
 * the blurb-equalization hunt.
 *
 * ## Why this row exists, in the tester's words
 *
 * *"Karen might be the perfect fit for me, but she has no information here.
 * So I'm only going to look at the folks that do have information."* The app
 * can say nothing about anyone and still tilt a race, because a thin card
 * tracks incumbency and campaign professionalism rather than merit. That is
 * a thumb on the scale no neutrality rule catches, and B14 is the answer:
 * run the hunt for EVERY candidate to the same rung depth.
 *
 * ## The rung this module is
 *
 * The campaign's own `og:description` — a sentence the campaign wrote to
 * describe itself, captured on the corpus retrieval and stored per document.
 *
 * **It is deliberately not a lead sentence we chose.** Picking the "best"
 * sentence out of a candidate's page is an editorial act attributed to a real
 * person, and doing it for 35 people would be 35 small editorial acts with no
 * source record. A description the campaign authored for exactly this purpose
 * — to introduce itself in one line — is their words about themselves, and it
 * carries the same label the curated bios already carry.
 *
 * ## It never outranks a curated bio
 *
 * Where a session has hand-read a candidate's site and written the bio down,
 * that stands. This fills the gap underneath it, which is the whole point:
 * the gap is where the inequality lives.
 */

export interface DerivedBlurb {
  text: string;
  /** The page it came from, so the reader can check it. */
  sourceUrl: string;
  /** The label, in the shape every blurb in this product carries. */
  sourceLabel: string;
  /** Whether the URL was hunted and verified, or only stated in a filing. */
  basis: CandidateDocument["basis"];
}

/**
 * Prefer a campaign site over an official one: B14 asks for a description of
 * the CANDIDATE, and an office's own page describes the office. Within a
 * class, prefer a hunted-and-verified URL over a filed one.
 */
function rank(doc: CandidateDocument): number {
  const site = doc.sourceClass === "CAMPAIGN_SITE" ? 0 : 2;
  const basis = doc.basis === "HUNTED_AND_VERIFIED" ? 0 : 1;
  return site + basis;
}

export function derivedBlurbFor(candidateKey: string): DerivedBlurb | null {
  const candidates = getCandidateCorpus()
    .documents.filter((d) => d.candidateKey === candidateKey && d.metaDescription)
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
    // The blurb-source rule, in the register the candidate cards already
    // ship. A description without its source class is treated as a generated
    // claim and removed, so the label is not decoration.
    sourceLabel:
      doc.sourceClass === "CAMPAIGN_SITE"
        ? `In the campaign's words — ${host}, read ${read}`
        : `In the office's own words — ${host}, read ${read}`,
    basis: doc.basis,
  };
}
