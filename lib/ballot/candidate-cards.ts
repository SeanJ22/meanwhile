import { readFileSync } from "node:fs";
import { join } from "node:path";

import { officialPhotoForPerson } from "../photos/person.ts";

/**
 * Kelly-standard candidate cards (2b, 2026-08-17): the curated photo / bio /
 * contact layer over the verified-links layer in `candidate-sites.ts`.
 *
 * The two files stay separate because they are different hunts with
 * different rules: a link is verified by fetching it; a card's photo must be
 * a URL from the candidate's own cited page (campaign site for challengers —
 * the author-adjusted photo rule — since a challenger has no official
 * portrait), HEAD-verified as an image, and labeled with its source. Bios
 * are the site's own words, attributed with a read date — never our
 * characterization of the person.
 *
 * Keys match `candidate-links-2026.json`: the candidacy id for filed
 * candidates, `<contestId>|<name>` for certified-lineup nominees.
 */

export interface CandidateCardData {
  photoUrl: string | null;
  /** The photo's source, labeled — rendered with the image, never dropped. */
  photoSource: string | null;
  /** The candidate's own site's words. Rendered attributed, in quotes. */
  bio: string | null;
  bioSourceUrl: string | null;
  bioSourceLabel: string | null;
  email: string | null;
  phone: string | null;
}

interface CandidateCardsFile {
  curatedAt: string;
  note: string;
  cards: Record<string, CandidateCardData>;
  hunts: { key: string; name: string; note: string; attemptedAt: string }[];
}

let cache: CandidateCardsFile | null = null;

function load(): CandidateCardsFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "ballot", "candidate-cards-2026.json"),
        "utf8",
      ),
    ) as CandidateCardsFile;
  }
  return cache;
}

/**
 * One person, one photo (item 6b, 2026-08-15). A card for a sitting
 * officeholder renders the SAME portrait their officials row does — and
 * carries that portrait's own attribution, because swapping the image
 * without swapping the credit would put a government portrait under a
 * Commons photographer's name. Nine people were wearing two faces before
 * this ran; `lib/photos/person.ts` states the precedence.
 */
function withPersonPhoto(
  card: CandidateCardData | null,
  personName: string,
): CandidateCardData | null {
  if (!card) return card;
  const official = officialPhotoForPerson(personName);
  if (!official || official.url === card.photoUrl) return card;
  return { ...card, photoUrl: official.url, photoSource: official.source };
}

/** The person's name as filed, recovered from the candidacy id's tail. */
function nameFromCandidacyId(candidacyId: string): string {
  const tail = candidacyId.split(":").pop() ?? "";
  return tail.split("-").reverse().join(" ");
}

export function cardForCandidacy(candidacyId: string): CandidateCardData | null {
  return withPersonPhoto(
    load().cards[candidacyId] ?? null,
    nameFromCandidacyId(candidacyId),
  );
}

export function cardForNominee(
  contestId: string,
  name: string,
): CandidateCardData | null {
  return withPersonPhoto(load().cards[`${contestId}|${name}`] ?? null, name);
}

export function allCandidateCards(): CandidateCardsFile {
  return load();
}

/**
 * The standard line for a candidate the app holds almost nothing on — item
 * 5 of the tester's mobile pass, 2026-08-14.
 *
 * Her finding, which is the reason this exists: "Karen might be the perfect
 * fit for me, but she has no information here. So I'm only going to look at
 * the folks that do have information." The app says nothing about anyone and
 * still tilts the race, because a thin card tracks incumbency and campaign
 * professionalism rather than merit, and silence reads as absence of the
 * candidate rather than absence of our research.
 *
 * Naming the gap is what converts it back into a statement about us. One
 * sentence, full stop: no apology, no second sentence, no explanation of
 * what we tried — that would be a paragraph on the thin cards and nothing on
 * the thick ones, which is the same asymmetry wearing a hair shirt.
 */
export const THIN_CANDIDATE_LINE =
  "We haven't found much about this candidate yet.";

/**
 * Whether a card is thin enough to earn the line.
 *
 * Deliberately the strict reading — thin means we found NOTHING a reader
 * could use: no photo, no words of their own, no way to reach them, and no
 * site to go read. A card carrying any one of those is not silent, and
 * stamping the line on it would be a false claim in the other direction.
 * Widening this is a one-line change here, and every surface follows.
 */
export function isThinCandidateCard(
  card: CandidateCardData | null,
  hasAnyLink: boolean,
): boolean {
  if (hasAnyLink) return false;
  if (!card) return true;
  return (
    !card.photoUrl && !card.bio && !card.email && !card.phone
  );
}
