/**
 * **WHERE A LINK GOES, WHEN WE DID NOT RECORD WHO PUBLISHED IT.**
 *
 * Mechanical: it reads a URL that is already on screen and says what host it
 * points at. It makes no claim about who published the page, which is precisely
 * the claim a phrase like "the record" makes for free — a link labelled that
 * way reads as an attributed source and is not one. The render-default sweep
 * caught exactly that on the ballot Ask panel.
 *
 * Shared by both Ask surfaces rather than copied into each (RULING 103): two
 * copies of a render default are two places for it to drift back into a claim.
 */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
