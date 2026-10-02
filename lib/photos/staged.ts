/** Held portrait candidates from earlier acquisition; publication verifies sources under §3. */
import { readFileSync } from "node:fs";
import type { PortraitDecodeRecord } from "./decode.ts";
import { join } from "node:path";

import { personKey } from "./person.ts";

/** Maximum aspect ratio of an existing staged portrait candidate. */
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
     * 2026-09-01, straight out of the OWN03 promotion. The author approved nine
     * portraits and four of them landed under the large card's 184px floor —
     * every one an Arizona Corporation Commissioner, because the URLs the
     * original pick took were Sitefinity RENDITIONS (`.tmb-thumb200.jpg`,
     * `MaxWidth=165`) rather than files.
     *
     * Dropping the rendition parameters on the same host returns the same
     * photographs at 2533–3275px wide. That is RULING 206 — the rendition is
     * one representation, the portrait is the record — and it is why this is a
     * REPLACEMENT obligation rather than a shortfall we live with.
     *
     * Registered here for the reason the block above gives: this list is
     * DECLARED, so an artifact nobody adds to it is an artifact the author
     * never sees.
     */
    path: "data/photos/door2-azcc-originals-2026-09-01.json",
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
