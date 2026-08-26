import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **RULING 55 — A PHOTO NEVER BLOCKS ANYTHING, AND EVERY PHOTO IS REVIEWED BY
 * SEAN.** (Adopted 2026-08-21, the author's ruling, NH Hunt 3.)
 *
 * ## Why this exists
 *
 * Three false portraits shipped past automated checks in a single session
 * (NH Hunt 2, 2026-08-20), and every one of them passed every mechanical test
 * the repo had:
 *
 * 1. a **flag stock photo**, alt-texted "Victor Orlando", served from a path
 *    containing `/images/headshots/`;
 * 2. a **scanned cover of a 1978 New Hampshire Grand Jury manual**, served as a
 *    campaign site's own `og:image` — a library document about to ship as a
 *    named man's face;
 * 3. a **name-and-office banner**, which is a graphic, not a person.
 *
 * A fourth was refused on a photographer's credit in its filename.
 *
 * All three were caught by a human READING THE IMAGE. Nothing else caught them,
 * because **a file existing is not a photograph of a person** — the URL
 * resolved, the content type was an image, the dimensions were plausible, the
 * source was the right domain. Every check the machine can run, passed.
 *
 * Rendering a wrong face is a false claim about a named person. That is the
 * same class of failure as generating a candidate position, and it is worse in
 * one way: a reader who sees a face believes it instantly and has no reason to
 * check.
 *
 * ## THIS IS NOT A SUPPRESSION PATH, and the distinction is the whole rule
 *
 * RULING 26 and RULING 27 forbid withholding what the product holds about a
 * person because something ELSE about them is missing. That is a COMPLETENESS
 * gate and it is dead in every form.
 *
 * This is a CORRECTNESS gate on one field, about that field's own truth. An
 * unreviewed image is not "data we hold about this person" — it may be a
 * picture of something else entirely, and three times in one session it was.
 * The distinction in practice:
 *
 * - **Nothing else on the card is affected.** Name, party, blurb, contacts,
 *   filed address, funding, votes, the battlecard door — all render exactly as
 *   they would if the photo had never been found. `tests/photo-review.test.ts`
 *   asserts a person renders fully with a photo pending.
 * - **A pending photo renders INITIALS**, which this product already treats as
 *   a success rather than a gap ("never — honest initials are a success", the
 *   frozen field matrix on `photo`). The card says nothing about the photo's
 *   state; per RULING 44 no per-card completeness marker may exist.
 * - **The gate never widens.** It reads the photo's own review record and
 *   nothing else. It cannot see another field, another candidate, or a count.
 *
 * ## A rejection is a BRANCH RESULT, never a permanent absence
 *
 * RULING 52: a branch coming back empty is one measurement on one date. A
 * rejected photo means *this image, from this source, is not this person* — it
 * says nothing about whether a correct portrait exists, and the hunt for one
 * continues. The reason is recorded so the next session does not re-propose the
 * same file, and the date is recorded so RULING 53's clock applies.
 */

/**
 * The three states, and only an approved photo renders.
 *
 * `PENDING` is the default for anything not in the store: a photo nobody has
 * looked at has not been approved, and defaulting the other way would restore
 * exactly the behaviour that shipped a 1978 court manual as a man's face.
 */
export type PhotoReviewState = "APPROVED" | "PENDING" | "REJECTED";

export interface PhotoReviewRecord {
  state: PhotoReviewState;
  /** Which image this decision is about. A new URL is a new decision. */
  url: string;
  /** Required on a rejection: what was wrong, in words a person can act on. */
  reason?: string;
  /** When the decision was made. RULING 53's clock runs from here. */
  decidedAt?: string;
  /** Who decided. Only the author approves; a session may only propose. */
  decidedBy?: string;
}

export interface PhotoReviewFile {
  note: string;
  /**
   * Keyed by the same person key the photo index uses, and holding a LIST.
   *
   * **A decision is about an IMAGE, not about a person**, and the first version
   * of this store held one record per person — which meant recording that Kelly
   * Ayotte's WinRed campaign banner was refused also withheld her official U.S.
   * Senate portrait, a public-domain federal work already shipping. Refusing one
   * file is not a finding about the next one, and a person may accumulate
   * several decisions over several hunts.
   */
  reviews: Record<string, PhotoReviewRecord[]>;
}

let cache: PhotoReviewFile | null = null;

function load(): PhotoReviewFile {
  if (!cache) {
    try {
      cache = JSON.parse(
        readFileSync(join(process.cwd(), "data", "photos", "review.json"), "utf8"),
      ) as PhotoReviewFile;
    } catch {
      /*
       * A missing or unreadable store is not "everything is approved". It is
       * "nothing has been reviewed", which is the safe reading and the honest
       * one — the same direction the PENDING default takes.
       */
      cache = { note: "unreadable or absent — nothing is approved", reviews: {} };
    }
  }
  return cache;
}

/** Test seam, and the same shape `resetPersonPhotoIndex` uses. */
export function resetPhotoReviewCache(): void {
  cache = null;
}

/**
 * The decision for one person's photo.
 *
 * The URL is part of the identity of the decision. Approving a portrait does
 * not approve whatever later replaces it at the same person key — that would
 * let a swapped file inherit a human's approval, which is the hole this whole
 * mechanism exists to close.
 */
export function reviewFor(personKey: string, url: string): PhotoReviewRecord {
  const forPerson = load().reviews[personKey] ?? [];
  const exact = forPerson.find((r) => r.url === url);
  if (exact) return exact;
  return {
    state: "PENDING",
    url,
    reason:
      forPerson.length > 0
        ? `${forPerson.length} decision(s) exist for this person but none for this image; a new file is a new decision`
        : "no decision recorded for this image",
  };
}

/** May this image render? Only an approved one. */
export function photoMayRender(personKey: string, url: string): boolean {
  return reviewFor(personKey, url).state === "APPROVED";
}

/** Every decision, flattened with the person it belongs to. */
function allRecords(): (PhotoReviewRecord & { personKey: string })[] {
  return Object.entries(load().reviews).flatMap(([personKey, list]) =>
    list.map((r) => ({ ...r, personKey })),
  );
}

/** Everything awaiting the author, for the one row a session opens per run. */
export function pendingReviews(): (PhotoReviewRecord & { personKey: string })[] {
  return allRecords().filter((r) => r.state === "PENDING");
}

export function rejections(): (PhotoReviewRecord & { personKey: string })[] {
  return allRecords().filter((r) => r.state === "REJECTED");
}

/**
 * Photos approved only because they were shipping when RULING 55 arrived.
 *
 * Named separately from `APPROVED` because they are a different claim:
 * grandfathered means *nobody has looked at this*, and reporting them as
 * reviewed would be the unread-evidence problem the ruling exists to end.
 */
export function grandfathered(): (PhotoReviewRecord & { personKey: string })[] {
  return allRecords().filter((r) => r.decidedBy === "grandfathered");
}
