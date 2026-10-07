/**
 * The ask pill's label teaches what can be asked without the box being open, so a bare "Ask" is not
 * allowed anywhere: where the pill's width forbids the full example string, the shortest form still names
 * at least one concrete example. `maxPx` is the space the pill actually has at 390px:
 *
 * * map top-right is the tightest: the pill shares `map-top-row` with the ballot pill and clears
 *   MapLibre's zoom column (`pr-14`), so the two pills split roughly 330px.
 * * sidebar top has the rail's full 340px less its padding, the pill alone on its row.
 * * WGH top has the card's width (the rail width at phone size), the pill alone on its row.
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

/** Every label names a concrete example. */
export const ASK_PILL_EXAMPLES: readonly string[] = ["meeting", "school"];
