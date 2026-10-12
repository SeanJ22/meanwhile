import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ENTRY = readFileSync(
  join(process.cwd(), "components", "map", "map-entry.tsx"),
  "utf8",
);

test("the large surface is a stack, and closing pops one frame", () => {
  assert.match(
    ENTRY,
    /const \[largeStack, setLargeStack\] = useState<LargeSurface\[\]>\(\[\]\)/,
    "the large surface must be a stack, not a slot",
  );
  assert.match(
    ENTRY,
    /const large = largeStack\.length > 0 \? largeStack\[largeStack\.length - 1\] : null/,
  );
  assert.match(ENTRY, /setBackStack\(\(stack\) => stack\.slice\(0, -1\)\)/);
});

test("a card opened from INSIDE another pushes; one opened from outside replaces", () => {
  assert.match(ENTRY, /const setLarge = useCallback\(\(next: LargeSurface \| null\) => \{\s*\n\s*setLargeStack\(next \? \[next\] : \[\]\);/);
  assert.match(ENTRY, /const pushLarge = useCallback/);

  const holder = ENTRY.slice(ENTRY.indexOf("onOpenHolder={(holder) =>"));
  assert.match(holder.slice(0, 300), /pushLarge\(\{/, "a roster name must stack, not replace");
  const placeBody = ENTRY.slice(ENTRY.indexOf("onOpenPlaceBody={(key) =>"));
  assert.match(placeBody.slice(0, 700), /pushLarge\(\{/, "a place card's body row must stack");
});

test("both large surfaces go back through the pop, not through a reset", () => {
  assert.equal([...ENTRY.matchAll(/<EntityModal\s+embedded/g)].length, 1, "the entity card renders inside the card frame");
  assert.equal([...ENTRY.matchAll(/<OfficialModal\s+embedded/g)].length, 1, "the person card renders inside the card frame");
  assert.match(ENTRY, /onBack=\{onCardBack\}/, "the frame's Back pops one view");
});

test("the stack is bounded, and it drops the OLDEST frame", () => {
  // The cap is a cycle guard; dropping from the front keeps the recent history.
  assert.match(ENTRY, /const LARGE_STACK_LIMIT = \d+;/);
  assert.match(ENTRY, /\.slice\(-LARGE_STACK_LIMIT\)/);
});
