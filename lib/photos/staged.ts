/**
 * **THE STAGED PORTRAIT QUEUE — an AUTHORING concern, and never the app's.**
 * (`NJ22`, closed 2026-08-25.)
 *
 * ## Why this is its own module rather than part of `review.ts`
 *
 * It was written inside `lib/photos/review.ts` first, and that file is imported
 * by `lib/ballot/candidate-cards.ts`, which is imported by `app/ballot/page.tsx`
 * — a Server Component. The build refused it, correctly and in as many words:
 *
 * > *Static analysis determined that this filesystem access causes the whole
 * > project to be traced and included in the output.*
 *
 * A `readFileSync` whose path comes from a variable cannot be statically scoped,
 * so the bundler has to assume any file might be read and traces everything —
 * the public folder included. That is a real deployment cost and the warning is
 * right to be a failure.
 *
 * **And the separation it forced is the correct one anyway.** The app decides
 * what a reader sees, and it answers that from `review.json`'s recorded
 * decisions. A queue of portraits somebody FOUND and has not shipped is a
 * question for the author, asked by a script, and the application has no
 * business being able to read it at all.
 *
 * Nothing here is approval and nothing here renders. `photoMayRender` lives in
 * `review.ts` and still answers only from a recorded `APPROVED` decision; this
 * is a way IN to the review, never a way around it.
 */
import { readFileSync } from "node:fs";
import type { PortraitDecodeRecord } from "./decode.ts";
import { join } from "node:path";

import { personKey } from "./person.ts";
import { reviewFor } from "./review.ts";

/**
 * **A STAGED PORTRAIT HAD NO CHANNEL TO THE AUTHOR; ONLY A SHIPPED ONE DID.**
 * (Tracker `NJ22`.)
 *
 * The review sheet read `candidate-cards-2026.json` and asked which of the
 * portraits ON A CARD were still unapproved. That is the right question for a
 * portrait that has already been written onto a card — and it means a portrait
 * a hunt FOUND and correctly refused to ship was invisible to the author,
 * because the only way onto the sheet was to do the thing the rule forbids.
 *
 * The live case: `pnpm door2` walked the nineteen sitting officials on the
 * 07866 ballot and found six name-matched portraits on their own municipal
 * `.gov` pages, four of them new. It shipped none, which is correct, and the
 * sheet then showed three pending — none of them his.
 *
 * So a staged queue is a first-class input to the sheet. A row here is a
 * portrait somebody FOUND and did not ship, and it reaches the author exactly
 * the way a card's does.
 *
 * **It is still not approval and it is still not rendering.** Nothing reads this
 * to decide what a reader sees; `photoMayRender` is unchanged and still answers
 * only from a recorded APPROVED decision. This is a way IN to the review, never
 * a way around it.
 */
/**
 * The widest a staged image may be relative to its height and still be
 * offered as a portrait. See the refusal in `stagedPortraits`.
 */
export const MAX_PORTRAIT_ASPECT = 1.5;

export interface StagedPortrait {
  personKey: string;
  name: string;
  url: string;
  /** Which door it would ship through, and why that door is open. */
  door: string;
  /** Where it was found — the page, so the author can check it himself. */
  foundOn: string;
  /** What matched, so a wrong face is arguable rather than asserted. */
  why: string;
  walkedAt: string;
  /** The artifact it came from, so a decision can be traced back. */
  source: string;
}

/**
 * Every staged portrait awaiting a decision, from every staging artifact.
 *
 * Files are DECLARED rather than globbed: a glob would silently pick up
 * whatever a later session happens to write into the directory, and the set of
 * things that may put a face in front of the author is exactly the set somebody
 * wrote down.
 */
const STAGING_FILES: readonly { path: string; door: string }[] = [
  {
    path: "data/photos/door2-incumbents-2026-08-25.json",
    door: "door 2 — the portrait a government body publishes of its own member",
  },
  {
    // OFF-3 (2026-08-25). NH166 is open and is Sean's: tusd1.org is a public
    // school district and is not a .gov host, so whether door 2 reaches a
    // district's own domain is his ruling. Staging is the ask, not the answer.
    path: "data/photos/door2-tusd-board-2026-08-25.json",
    door: "door 2 — the portrait a government body publishes of its own member",
  },
  {
    /*
     * 2026-08-28, the statewide-executive acquisition. Written by
     * `scripts/hunt-statewide-portraits-0828.mts` over the eleven officeholders
     * added to `lib/officials/statewide-executives.ts` that day — Arizona's
     * Secretary of State, Attorney General, Treasurer, Superintendent, Mine
     * Inspector and five Corporation Commissioners, plus New Jersey's
     * Lieutenant Governor.
     *
     * **Registering it here is not paperwork.** The list above is DECLARED
     * rather than globbed, on purpose, which means an artifact nobody adds to
     * it is an artifact the author never sees — a hunt that ran, found faces,
     * wrote them down, and reached nobody. Eight portraits would have sat in
     * that state.
     */
    path: "data/photos/door2-statewide-executives-2026-08-28.json",
    door: "door 2 — the portrait a government body publishes of its own member",
  },
  {
    /*
     * 2026-08-28. Door 3 over every filed candidate this repository holds no
     * portrait bytes for and records a link on the candidate's OWN domain —
     * 28 sites walked out of a 377-candidate cohort, which is the honest
     * reach of that door and not a shortfall of effort: 268 of the cohort
     * have no candidate link recorded at all, and 18 more are linked only to
     * a party committee's page, which is not the campaign's own site.
     *
     * Most of what it found is a DONATE BAR, which is what the banner-shape
     * refusal above exists to catch. That is the route working: it looked,
     * it named what it found, and it refused it on a measurement.
     */
    path: "data/photos/door3-ballot-cohort-2026-08-28.json",
    door: "door 3 — the portrait the campaign publishes of its own candidate, from its own site",
  },
];

/**
 * A staged row that was REFUSED, and why.
 *
 * Refusals are RETURNED rather than logged and dropped. A queue that silently
 * shrinks is the shape this repo names most often, and the two soft-404s that
 * caused this guard would have vanished into it without a word.
 */
export interface RefusedPortrait {
  name: string;
  url: string;
  reason: string;
  source: string;
}

const refusals: RefusedPortrait[] = [];

/** Every staged row refused by the last `stagedPortraits()` call. */
export function refusedPortraits(): RefusedPortrait[] {
  return [...refusals];
}

export function stagedPortraits(): StagedPortrait[] {
  const out: StagedPortrait[] = [];
  refusals.length = 0;
  for (const file of STAGING_FILES) {
    let parsed: {
      walkedAt?: string;
      rows?: {
        subject?: string;
        page?: string | null;
        portrait?: { src: string; alt: string; why: string } | null;
        photoAlreadyHeld?: boolean;
        decode?: PortraitDecodeRecord;
        attemptedAt?: string;
      }[];
    };
    try {
      parsed = JSON.parse(readFileSync(join(process.cwd(), file.path), "utf8")) as typeof parsed;
    } catch {
      /* An absent staging file is not an error — most sessions produce none. */
      continue;
    }
    for (const row of parsed.rows ?? []) {
      if (!row.portrait || !row.subject) continue;
      /*
       * A portrait already ON a card is the sheet's other input, and listing it
       * twice would put one face in front of the author under two numbers.
       */
      if (row.photoAlreadyHeld) continue;
      /*
       * **NOTHING QUEUES WITHOUT A PASSING DECODE.** (2026-08-25.)
       *
       * The door-2 hunt queued two soft-404 HTML pages as portraits — served
       * 200, several kilobytes each, `.jpg` in the URL — and only the
       * author's eyes on the review sheet caught them.
       *
       * The check lives HERE, at the door into the review, rather than in the
       * hunt that happened to produce them. A guard inside one hunt is a guard
       * the next hunt does not have, and there will be a next hunt. Every
       * staging artifact passes through this function, so this is the one
       * place that cannot be bypassed.
       *
       * A MISSING record refuses exactly as a FAILING one does. "Nobody
       * decoded this" and "this is not an image" are different facts and both
       * are disqualifying, and defaulting the other way is how an unchecked
       * row becomes a checked one by omission.
       */
      if (!row.decode?.ok) {
        refusals.push({
          name: row.subject,
          url: row.portrait.src,
          reason: row.decode
            ? `${row.decode.reason ?? "REFUSED"} — ${row.decode.detail ?? "no detail recorded"}`
            : "NOT DECODED — no decode record on the staged row, so nothing has confirmed these bytes are an image",
          source: file.path,
        });
        continue;
      }
      /*
       * **A BANNER IS A SHAPE, AND THE SHAPE IS MEASURABLE.** (2026-08-28.)
       *
       * The decode above proves the bytes are an image and at least 96px on
       * an edge. It cannot tell a face from a donate bar, and the first door-3
       * walk over the ballot cohort put three donate bars in the queue:
       *
       * ```
       * ChipInToday-1074.png              1074 x 311   3.45 : 1
       * a campaign hero on Squarespace    2400 x 1350  1.78 : 1
       * a campaign hero on imgix          2048 x 1166  1.76 : 1
       * ```
       *
       * Every genuine portrait this repository has staged is TALLER THAN WIDE
       * — measured across all four staging artifacts on 2026-08-28, fourteen
       * rows, aspect 0.67 to 1.00, not one above 1.0. A head-and-shoulders
       * photograph is portrait-shaped or square; nothing else is one.
       *
       * The gate is 1.5 rather than 1.0 so a genuinely landscape headshot —
       * they exist — still reaches the author, while a banner cannot. And it
       * lives HERE, at the one door into the review that no staging artifact
       * can bypass, for the same reason the decode does (RULING 103).
       *
       * It is still not a judgement about whether the face is the right one.
       * Only the author decides that.
       */
      const w = row.decode.width ?? 0;
      const h = row.decode.height ?? 0;
      if (w > 0 && h > 0 && w / h > MAX_PORTRAIT_ASPECT) {
        refusals.push({
          name: row.subject,
          url: row.portrait.src,
          reason:
            `BANNER SHAPE — ${w}x${h} is ${(w / h).toFixed(2)}:1, and a head-and-shoulders ` +
            `portrait is not wider than ${MAX_PORTRAIT_ASPECT}:1. This is a measurement of the ` +
            "image, not a judgement about the person in it.",
          source: file.path,
        });
        continue;
      }
      out.push({
        personKey: personKey(row.subject),
        name: row.subject,
        url: row.portrait.src,
        door: file.door,
        foundOn: row.page ?? "(no page recorded)",
        why: row.portrait.why,
        walkedAt: row.attemptedAt ?? parsed.walkedAt ?? "unknown",
        source: file.path,
      });
    }
  }
  return out;
}

/** Staged portraits with no decision recorded — what the author has not seen. */
export function stagedAwaitingReview(): StagedPortrait[] {
  return stagedPortraits().filter((p) => reviewFor(p.personKey, p.url).state === "PENDING");
}
