import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { COMMITTEE_TYPE_LABELS } from "../lib/funding/committee-types.ts";
import {
  PILL_FAMILY_BY_TYPE_ID,
  pillClassFor,
} from "../lib/funding/pill-colors.ts";

/**
 * Every funding label has an explicit pill family, and every family stays inside the allowed palette; the party
 * palette must never be reachable from a pill class.
 */

const ALLOWED_FAMILIES = ["teal", "cyan", "amber", "gold", "slate", "stone"];

test("every renderable funding type label has an explicit pill family", () => {
  for (const label of COMMITTEE_TYPE_LABELS) {
    assert.ok(
      label.id in PILL_FAMILY_BY_TYPE_ID,
      `type label "${label.id}" has no pill family — add it to lib/funding/pill-colors.ts`,
    );
  }
});

test("every assigned family is in the allowed non-party palette", () => {
  for (const [id, family] of Object.entries(PILL_FAMILY_BY_TYPE_ID)) {
    assert.ok(
      ALLOWED_FAMILIES.includes(family),
      `type "${id}" is assigned family "${family}", outside the allowed palette`,
    );
  }
});

test("pillClassFor returns a stable class pair for every label", () => {
  for (const label of COMMITTEE_TYPE_LABELS) {
    const cls = pillClassFor(label);
    assert.match(cls, /^pill pill--(teal|cyan|amber|gold|slate|stone)$/);
  }
});

test("the pill tokens never reuse a party color value", () => {
  // A pill family whose literal equals a party literal would read as partisan.
  const css = readFileSync("app/globals.css", "utf8");
  const partyValues = [
    ...css.matchAll(/--party-[a-z]+:\s*([^;]+);/g),
  ].map((m) => m[1].trim().toLowerCase());
  const pillValues = [
    ...css.matchAll(/--pill-[a-z]+-(?:text|bg):\s*([^;]+);/g),
  ].map((m) => m[1].trim().toLowerCase());
  assert.ok(partyValues.length >= 5, "party tokens should exist");
  assert.ok(pillValues.length >= 12, "pill tokens should exist");
  for (const value of pillValues) {
    assert.ok(
      !partyValues.includes(value),
      `pill token value ${value} duplicates a party color`,
    );
  }
});
