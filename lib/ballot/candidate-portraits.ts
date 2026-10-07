import { imagesIn, pickPortraits } from "../hunt/portrait-pick.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { PortraitRuntime } from "../photos/store.ts";
import { storeVerifiedPortrait } from "../photos/store.ts";
import type { CandidateCardData } from "./candidate-cards.ts";

export interface CandidateSitePage {
  readonly name: string;
  readonly office: string;
  readonly cycle: string;
  readonly capture: WorkerPublicationCapture;
}

export type CandidatePortraitPatch = Pick<CandidateCardData, "photoUrl" | "photoSource" | "photoVerification">;

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
