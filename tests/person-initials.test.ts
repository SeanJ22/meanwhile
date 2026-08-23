/**
 * **The initials that stand in for a face.** (NJ Hunt 6, 2026-08-22.)
 *
 * Found by reading a capture as an image, which is the whole reason RULING 2
 * exists: **Thomas J. Haynes III rendered as `TI`** on the Rockaway Borough
 * council. Every DOM assertion in the suite was happy — the element was present,
 * painted, and carried two letters.
 *
 * The sweep that followed found the same function written out THREE times, in
 * `person-identity.tsx`, `official-popup.tsx` and `candidate-card.tsx`, with
 * three different behaviours — the third took the first two alphabetic tokens,
 * so `Thomas J. Haynes` initialled a middle name and rendered `TJ`. All three
 * now call one implementation, and this holds it.
 *
 * It is a small thing on a named public person's row, which is where small
 * things matter most: the initials are what a reader sees INSTEAD of him, and
 * getting them wrong makes our missing photo look like a defect about him.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { personInitials } from "../lib/officials/person-name.ts";

test("a generational suffix is not a surname", () => {
  assert.equal(personInitials("Thomas J. Haynes III"), "TH");
  assert.equal(personInitials("Marcos Tapia-Aguilar, Sr."), "MT");
  assert.equal(personInitials("Art Bruhn, Jr."), "AB");
  assert.equal(personInitials("Charles Aaron Jr"), "CA");
  // Stacked suffixes happen.
  assert.equal(personInitials("Robert King Jr. III"), "RK");
});

test("the initials are the FIRST and the SURNAME, never the middle name", () => {
  assert.equal(personInitials("Thomas J. Haynes"), "TH");
  assert.equal(personInitials("Susan Fahrman Royek"), "SR");
  assert.equal(personInitials("Melissa Florance-Lynch"), "MF");
});

test("the ordinary cases still hold", () => {
  assert.equal(personInitials("Joseph Jackson"), "JJ");
  assert.equal(personInitials("Adrienne Zimmermann"), "AZ");
  assert.equal(personInitials("Cher"), "C");
});

test("a name that is only a suffix, or empty, does not throw", () => {
  assert.equal(personInitials(""), "");
  assert.equal(personInitials("III"), "I");
  assert.equal(personInitials("   "), "");
});
