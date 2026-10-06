/**
 * G07 — THE ASK PILL'S LABEL CARRIES THE TEACHING (2026-08-17).
 *
 * The cost of 4a: hiding the box behind
 * a pill is cleaner but gets used less, and typed questions are the highest-
 * intent signal this product collects. So the pill's label does the work the
 * open box used to do — **the reader learns what can be asked without the box
 * being open** — and a bare "Ask" is not allowed anywhere.
 *
 * The rule this sets, and the reason this file exists rather than three
 * string literals in three components: *"Where the pill's width forbids the
 * full example string, use the shortest form that still names at least one
 * concrete example."* A label that degrades to "Ask" under pressure has lost
 * the entire point, so the shortest form here still names an example. Each row
 * records the width that forced it, and `docs/DESIGN.md` cites this file
 * rather than restating the strings — two copies of a label drift, and the one
 * in the doc is the copy nothing renders.
 *
 * `maxPx` is the space the pill actually has at 390px, measured on the
 * rendered surface rather than assumed:
 *
 * * **map top-right** is the tightest by a wide margin. The pill shares
 *   `map-top-row` with the ballot pill and the row clears MapLibre's zoom
 *   column (`pr-14`), so at 390px the two pills split roughly 330px between
 *   them. The full example string does not fit and this is the placement the
 *   rule's "shortest form" clause was written for.
 * * **sidebar top** has the rail's full 340px less its padding, and the pill
 *   is the only thing on its row.
 * * **WGH top** has the card's width, which is the same rail width at phone
 *   size, and the pill is likewise alone on its row.
 */

import { copy } from "../design/copy.ts";
import type { AskPillPlacement } from "../map/cluster-placement.ts";

export type { AskPillPlacement };

export interface AskPillLabel {
  placement: AskPillPlacement;
  /** What the pill says. Never a bare verb — always one concrete example. */
  label: string;
  /** The accessible name, which may be longer than the visible label. */
  ariaLabel: string;
  /** The width the placement actually affords at 390px, in CSS pixels. */
  maxPx: number;
  /** Why this form and not the longer one. */
  note: string;
}

export const ASK_PILL_LABELS: Readonly<Record<AskPillPlacement, AskPillLabel>> =
  {
    map: {
      placement: "map",
      label: copy("copy.askMap"),
      ariaLabel: copy("copy.askAccessible"),
      maxPx: 150,
      note:
        "Shares map-top-row with the ballot pill and clears MapLibre's zoom column (pr-14). At 390px the two pills split ~330px, so the full example string overflows and the shortest form that still names an example is used.",
    },
    sidebar: {
      placement: "sidebar",
      label: copy("copy.askSidebar"),
      ariaLabel: copy("copy.askAccessible"),
      maxPx: 316,
      note:
        "The 340px rail less its 12px horizontal padding on each side. The pill is alone on its row, so the full example string fits.",
    },
    wgh: {
      placement: "wgh",
      label: copy("copy.askWgh"),
      ariaLabel: copy("copy.askAccessible"),
      maxPx: 316,
      note:
        "The who-governs card at phone width is the same 340px envelope as the rail, and the pill is alone on its row.",
    },
  };

/** Every label names a concrete example — the guard G07 asks for, as code. */
export const ASK_PILL_EXAMPLES: readonly string[] = ["meeting", "school"];
