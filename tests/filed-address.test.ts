import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **RULING 54 — PUBLIC INFORMATION IS SHOWN.** (Adopted 2026-08-21, the
 * author's ruling; tracker `NH12`.)
 *
 * A candidate's filed mailing address is on a public form the candidate
 * submitted for exactly this purpose. The project's standing commitment is that
 * it looks hard enough to find what is public; having found it, withholding it
 * is the information asymmetry the display rulings exist to prevent.
 *
 * All 47 addresses on Newbury's ballot were hunted, recorded, and written into
 * a prose `note` that nothing renders — so the product held the only working
 * contact for about half of those people and showed none of them.
 *
 * **The scope is the filing and nothing beyond it.** This does not extend to
 * information that is not on a public filing.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

interface Card {
  filedAddress?: string | null;
  filedAddressSource?: string | null;
}

const file = JSON.parse(read("data", "ballot", "candidate-cards-2026.json")) as {
  cards: Record<string, Card>;
  hunts: { key: string; name: string; note: string }[];
};

test("every recorded filed address reached a card — stated N equals rendered rows", () => {
  /*
   * The denominator is knowable, so it is asserted rather than trusted. The
   * lift script's first version used `.find` over a `hunts` array holding 175
   * records against 92 cards, silently took whichever note came first, and
   * lifted 4 of 47 — a clean exit and a wrong number. That is the collapsing-
   * join shape, and this is the check that would have caught it.
   */
  const recorded = file.hunts.filter((h) => /FILED CONTACT/.test(h.note ?? "")).length;
  const rendered = Object.values(file.cards).filter((c) => c.filedAddress).length;
  assert.ok(recorded > 40, `expected the recorded filings, found ${recorded}`);
  assert.equal(
    rendered,
    recorded,
    `${recorded} addresses are recorded and ${rendered} reached a card. A partial ` +
      "lift renders a contact for some candidates and not others on no principle at all",
  );
});

test("every filed address carries its source — a contact without one is a generated claim", () => {
  const naked = Object.entries(file.cards)
    .filter(([, c]) => c.filedAddress && !c.filedAddressSource)
    .map(([k]) => k);
  assert.deepEqual(naked, [], `these render an address with no source: ${naked.join(", ")}`);
});

test("no address was invented — every one ends in a real NH ZIP", () => {
  // The parse anchors on `<City> NH <zip>`. A value that does not end that way
  // is a half-read address under a named person's name, which is worse than
  // an honest gap.
  const malformed = Object.entries(file.cards)
    .filter(([, c]) => c.filedAddress && !/\bNH\s+\d{5}(-\d{4})?$/.test(c.filedAddress))
    .map(([k, c]) => `${k}: ${c.filedAddress}`);
  assert.deepEqual(malformed, [], `malformed addresses: ${malformed.join(" | ")}`);
});

test("the two the ruling names by hand are contactable", () => {
  /*
   * RULING 54 names them: "For Kathleen Donnelly and Cynthia Rusis it is the
   * only contact that exists, and their cards currently offer no way to reach
   * them while their opponents show phones and sites."
   */
  for (const who of ["donnelly", "rusis"]) {
    const entry = Object.entries(file.cards).find(([k]) => k.toLowerCase().includes(who));
    assert.ok(entry, `no card found for ${who}`);
    assert.ok(
      entry[1].filedAddress,
      `${who} still has no way for a reader to reach them — RULING 54 is not satisfied`,
    );
  }
});

test("the card renders the address as a FACT, not as a tappable affordance", () => {
  const card = read("components", "ballot", "candidate-card.tsx");
  assert.match(card, /card\?\.filedAddress &&/, "the card renders it");
  assert.match(card, /filedAddressSource/, "and renders its source beside it");
  /*
   * A `mailto:` or `tel:` is an invitation to act now. A mailing address is a
   * fact about where someone lives, and dressing it as an affordance would
   * overstate what it is — and would be a click-to-act gesture on a named
   * private residence.
   */
  const block = card.slice(card.indexOf("card?.filedAddress &&"));
  const rendered = block.slice(0, block.indexOf("</p>"));
  assert.ok(!/href=/.test(rendered), "the filed address must not be a link");
});
