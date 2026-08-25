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
];

export function stagedPortraits(): StagedPortrait[] {
  const out: StagedPortrait[] = [];
  for (const file of STAGING_FILES) {
    let parsed: {
      walkedAt?: string;
      rows?: {
        subject?: string;
        page?: string | null;
        portrait?: { src: string; alt: string; why: string } | null;
        photoAlreadyHeld?: boolean;
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
