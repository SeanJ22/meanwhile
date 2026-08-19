import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * **F01 2.4 (2026-08-19, the author) — NAVIGATION UNWINDS ONE LEVEL AT A TIME.**
 *
 * *"If I go to More to open a large battle card, open Representation, and
 * select Dr. Ravi Shah, his card pops up, which is right. However, if I close
 * out Dr. Ravi Shah, it brings me back to the map. It doesn't bring me back to
 * Tucson Unified."*
 *
 * The large surface was ONE SLOT, so a card opened from inside another card
 * replaced it and closing had nowhere to go but the map. These guards hold the
 * stack in source, because the failure is invisible until somebody clicks three
 * levels down and comes back out — which is exactly how it survived to a
 * walkthrough.
 */

const ENTRY = readFileSync(
  join(process.cwd(), "components", "map", "map-entry.tsx"),
  "utf8",
);

test("F01 2.4: the large surface is a stack, and closing pops one frame", () => {
  assert.match(
    ENTRY,
    /const \[largeStack, setLargeStack\] = useState<LargeSurface\[\]>\(\[\]\)/,
    "the large surface must be a stack, not a slot",
  );
  // The visible card is the TOP of the stack.
  assert.match(
    ENTRY,
    /const large = largeStack\.length > 0 \? largeStack\[largeStack\.length - 1\] : null/,
  );
  // Closing removes exactly one frame — never the whole stack.
  assert.match(ENTRY, /setLargeStack\(\(stack\) => stack\.slice\(0, -1\)\)/);
});

test("F01 2.4: a card opened from INSIDE another pushes; one opened from outside replaces", () => {
  // The one-at-a-time rule is unchanged for outside openers: openLarge still
  // sets a stack of one, so two unrelated battlecards can never nest.
  assert.match(ENTRY, /const setLarge = useCallback\(\(next: LargeSurface \| null\) => \{\s*\n\s*setLargeStack\(next \? \[next\] : \[\]\);/);
  assert.match(ENTRY, /const pushLarge = useCallback/);

  // The two doors that open a card from inside one must PUSH. These are the
  // author's case (a roster name on a body card) and its sibling (a body row
  // on a place card).
  const holder = ENTRY.slice(ENTRY.indexOf("onOpenHolder={(holder) =>"));
  assert.match(holder.slice(0, 300), /pushLarge\(\{/, "a roster name must stack, not replace");
  const placeBody = ENTRY.slice(ENTRY.indexOf("onOpenPlaceBody={(key) =>"));
  assert.match(placeBody.slice(0, 700), /pushLarge\(\{/, "a place card's body row must stack");
});

test("F01 2.4: both large surfaces close through the pop, not through a reset", () => {
  // Two modals render off the stack. If either one reset it, the fix would be
  // half-applied and the reader would lose their place from one card and not
  // the other — which is exactly the shape that produced the defect.
  const closes = [...ENTRY.matchAll(/onClose=\{closeLarge\}/g)];
  assert.equal(closes.length, 2, "both the entity modal and the official modal must pop");
});

test("F01 2.4: the stack is bounded, and it drops the OLDEST frame", () => {
  // A reader can bounce between a board's card and a member's card for as long
  // as they like. The cap is a cycle guard; dropping from the front keeps the
  // recent history, which is the history a back gesture is about.
  assert.match(ENTRY, /const LARGE_STACK_LIMIT = \d+;/);
  assert.match(ENTRY, /\.slice\(-LARGE_STACK_LIMIT\)/);
});
