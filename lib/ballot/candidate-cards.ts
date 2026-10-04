import { currentCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import { officialPhotoForPerson } from "../photos/person.ts";

/**
 * Kelly-standard candidate cards (2b, 2026-08-17): the curated photo / bio /
 * contact layer over the verified-links layer in `candidate-sites.ts`.
 *
 * The two files stay separate because they are different hunts with
 * different rules: a link is verified by fetching it; a card's photo must be
 * a URL from the candidate's own cited page (campaign site for challengers —
 * the adjusted photo rule — since a challenger has no official
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
  /** Field-level publication note retained by the municipal contact collector. */
  phoneSource?: string | null;
  /**
   * **WHOSE LINE THIS IS, WHEN IT IS NOT THE CANDIDATE'S OWN** (RULING 64,
   * adopted 2026-08-21, the author's ruling; applied 2026-08-22, NJ Hunt item
   * 2.2; `NH55`).
   *
   * In a small jurisdiction the County Attorney, the Register of Deeds and the
   * Sheriff plausibly share an address and a switchboard. **That is a fact
   * about the office, not a data defect**, and the ruling is that the number is
   * PUBLISHED — labelled as the office line rather than as the candidate's
   * personal contact. A reader who wants to reach that person can.
   *
   * The label is what makes it honest, and it is why this field exists rather
   * than the number simply being left in `phone`. Two Merrimack County Attorney
   * candidates carried `(603) 228-0529` and `603-228-0529` — the same
   * switchboard, in two formats, on two cards, with nothing saying so. Unlabelled,
   * that reads as each candidate's own number and is a claim we cannot support;
   * it also trips the distinctness rule in `CLAUDE.md`, which presumes identical
   * payloads across distinct keys to be broken until proven otherwise.
   *
   * Verified on the county's own page before it was labelled: `(603) 228-0529`
   * at 4 Court Street, Concord NH 03301 is the Merrimack County Attorney's
   * office, read 2026-08-22 at rung 2 from
   * `merrimackcounty.net/departments/county_attorney/index.php`.
   *
   * Null on every card where the contact IS the candidate's own.
   */
  phoneLabel: string | null;
  /** @deprecated Filed addresses are evidence only; reader projections always clear them. */
  filedAddress: string | null;
  /** @deprecated Kept nullable while the Ask lane removes its legacy field contract. */
  filedAddressSource: string | null;
}

export interface CandidateCardsFile {
  readonly curatedAt: string;
  readonly note: string;
  readonly cards: Readonly<Record<string, CandidateCardData>>;
  readonly hunts: readonly { readonly key: string; readonly name: string; readonly note: string; readonly attemptedAt: string }[];
}

function load(): CandidateCardsFile {
  const held = currentCandidateProfilesProjection().cards;
  // Acquisition notes can contain the same filed addresses. They remain in
  // saved evidence, never in the object passed to a reader or Ask.
  return { curatedAt: held.curatedAt, note: "", hunts: [],
    cards: Object.fromEntries(Object.entries(held.cards).map(([key, card]) =>
      [key, { ...card, filedAddress: null, filedAddressSource: null }])) };

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
  const merged =
    !official || official.url === card.photoUrl
      ? card
      : { ...card, photoUrl: official.url, photoSource: official.source };
  // Published bindings stay visible. New and changed portraits pass §3 at publication.
  return merged;
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

/*
 * **`THIN_CANDIDATE_LINE` AND `isThinCandidateCard` ARE DELETED** (RULING 42,
 * Prompt E item 3, 2026-08-20). This note stands in their place so the next
 * reader of this file learns they were removed on purpose rather than
 * wondering where they went.
 *
 * What they did: the constant was the sentence "We haven't found much about
 * this candidate yet.", and the predicate decided which cards earned it — a
 * card with no photo, no words, no contact and no link.
 *
 * Why they are gone: the pair put a marker on exactly one kind of card, and
 * the kind was "the candidate we know least about". A badge worn only by the
 * least-resourced person in a race is the information asymmetry the
 * equal-effort rule exists to catch, pointed the other way, and it was the
 * per-card repetition RULING 28 had already ended everywhere else on the page.
 *
 * What replaced it: one page-level disclosure at the foot of the ballot —
 * `COLLECTION_NOTE` in `app/ballot/page.tsx` — which says the same thing about
 * every card at once and singles nobody out. The equal-effort discipline is
 * unchanged and still binding; it lives in the HUNT, which is where
 * `CLAUDE.md` and RULING 26 both say it belongs.
 *
 * Guarded: `tests/no-suppression.test.ts` fails the build if a per-card
 * completeness marker returns, and `pnpm walk:all` fails against production
 * on the same thing.
 */
