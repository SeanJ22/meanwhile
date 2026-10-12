// The initials stand in for a missing photo, so all surfaces share this one implementation.

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
