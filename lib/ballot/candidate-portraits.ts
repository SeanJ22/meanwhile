import { imagesIn, pickPortraits } from "../hunt/portrait-pick.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { PortraitRuntime } from "../photos/store.ts";
import { storeVerifiedPortrait } from "../photos/store.ts";
import type { CandidateCardData } from "./candidate-cards.ts";

/** The verified campaign site a portrait is read from: the page must name the candidate, office and cycle. */
export interface CandidateSitePage {
  readonly name: string;
  readonly office: string;
  readonly cycle: string;
  readonly capture: WorkerPublicationCapture;
}

export type CandidatePortraitPatch = Pick<CandidateCardData, "photoUrl" | "photoSource" | "photoVerification">;

/**
 * CA-08: a candidate's portrait from their own verified campaign page. The
 * image must carry the person's name on that page (`pickPortraits`), is stored
 * in the portrait blob store under `candidates/`, and is bound on the card by
 * its OWN_PAGE verification, so it goes live with no release and no commit to
 * `public/`. Returns a gap, never a guess, when the page shows no named image.
 */
export async function candidatePortraitFromOwnSite(page: CandidateSitePage, now: string, io?: PortraitRuntime):
  Promise<{ readonly patch: CandidatePortraitPatch } | { readonly gap: string }> {
  const { canonicalUrl, text } = page.capture.evidence;
  const image = pickPortraits(page.name, imagesIn(text, canonicalUrl))[0];
  if (!image) return { gap: "PORTRAIT_NOT_ON_OWN_PAGE" };
  const photo = await storeVerifiedPortrait(page.name, {
    imageUrl: image.src,
    captures: [page.capture],
    campaign: { url: canonicalUrl, name: page.name, office: page.office, cycle: page.cycle },
  }, now, io, "candidates");
  if (photo.verification?.basis !== "OWN_PAGE") return { gap: "PORTRAIT_NOT_FROM_OWN_PAGE" };
  return { patch: { photoUrl: photo.url, photoSource: `Portrait from the campaign's own site, ${new URL(canonicalUrl).hostname.replace(/^www\./, "")}`,
    photoVerification: photo.verification } };
}
