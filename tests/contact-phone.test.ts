import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { phoneChoicesFor, telHref } from "../lib/officials/phone-numbers.ts";

/**
 * **R39 — one Phone pill replaces stacked numbers, everywhere.**
 *
 * 2026-08-17, the author's production feedback. Jeanne Shaheen's card rendered
 * seven stacked phone rows; the author's standing rule is that a named
 * instance is an EXAMPLE of a class, so the guard here is about the RULE, not
 * about Shaheen.
 *
 * The rule, in three parts, each of which can fail on its own:
 *
 * 1. The number of numbers is computed ONCE, from the recorded data, and the
 *    render's shape follows from it. Two numbers is a modal; one is a direct
 *    `tel:` link; none is no pill at all.
 * 2. Labels come from the record. Never from an area code — that would be a
 *    generated claim about where a public official's line goes.
 * 3. The displayed number keeps its published formatting, and only the `href`
 *    is stripped to digits.
 */

function code(path: string[]): string {
  return readFileSync(join(process.cwd(), ...path), "utf8");
}

const PILLS = code(["components", "officials", "contact-pills.tsx"]);
const MODAL = code(["components", "officials", "phone-choice-modal.tsx"]);
const CSS = code(["app", "globals.css"]);

test("seven offices collect to seven choices, district first, Washington last", () => {
  // Shaheen's shape, as the directory publishes it: six district offices and
  // the term record's Washington line.
  const choices = phoneChoicesFor({
    phone: "(202) 224-2841",
    districtOffices: [
      { city: "Manchester", phone: "(603) 647-7500" },
      { city: "Nashua", phone: "(603) 883-0196" },
      { city: "Portsmouth", phone: "(603) 433-1667" },
      { city: "Claremont", phone: "(603) 542-4872" },
      { city: "Berlin", phone: "(603) 752-6300" },
      { city: "Keene", phone: "(603) 358-6604" },
    ],
    ownLabel: "Washington office",
  });

  assert.equal(choices.length, 7);
  // District first — it is the one that answers. g4 item 8's finding, which
  // R39 did not change; it changed only what happens to the list.
  assert.equal(choices[0].label, "Manchester office");
  assert.equal(choices[6].label, "Washington office");
  assert.equal(choices[6].phone, "(202) 224-2841");
});

test("one number is one choice — the case that must NOT get a modal", () => {
  const choices = phoneChoicesFor({ phone: "(603) 271-2121" });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].phone, "(603) 271-2121");
});

test("no recorded number is no choices — never a placeholder row", () => {
  assert.deepEqual(phoneChoicesFor({ phone: null }), []);
  assert.deepEqual(
    phoneChoicesFor({ phone: null, districtOffices: [{ city: "Tucson", phone: null }] }),
    [],
  );
});

test("offices sharing a switchboard collapse to one row", () => {
  // Four offices, one number. Four identical rows in the chooser would be the
  // wall this was built to remove, rebuilt inside the fix.
  const choices = phoneChoicesFor({
    phone: null,
    districtOffices: [
      { city: "Tucson", phone: "(520) 555-0100" },
      { city: "Nogales", phone: "(520) 555-0100" },
      { city: "Sahuarita", phone: "(520) 555-0100" },
      { city: "Somerton", phone: "(520) 555-0100" },
    ],
  });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].label, "Tucson office");
});

test("a Washington number that IS a district number is one number, not two", () => {
  const choices = phoneChoicesFor({
    phone: "(202) 225-0001",
    districtOffices: [{ city: "Concord", phone: "(202) 225-0001" }],
    ownLabel: "Washington office",
  });
  assert.equal(choices.length, 1);
  // It keeps the label the record supports for it.
  assert.equal(choices[0].label, "Concord office");
});

test("a label is never invented — an office with no published city says so", () => {
  const choices = phoneChoicesFor({
    phone: null,
    districtOffices: [{ city: null, phone: "(603) 555-0111" }],
  });
  assert.equal(choices[0].label, "District office");
  // And no label anywhere is derived from the number itself. An area code is
  // where a number was ISSUED, not where the line rings.
  const source = code(["lib", "officials", "phone-numbers.ts"]);
  assert.ok(
    !/phone\.(slice|substring|match|replace)\([^)]*\)[^;]*label/i.test(source),
    "no label may be derived from the number",
  );
});

test("the href strips to digits; the displayed number keeps its formatting", () => {
  assert.equal(telHref("(603) 647-7500"), "tel:6036477500");
  assert.equal(telHref("+1 202-224-2841"), "tel:+12022242841");
  // The choice itself is untouched — the render puts this on the face.
  const choices = phoneChoicesFor({ phone: "(603) 647-7500" });
  assert.equal(choices[0].phone, "(603) 647-7500");
});

test("the pill row branches on the COUNT, and only above one opens a modal", () => {
  assert.ok(
    /phoneChoices\.length > 1/.test(PILLS),
    "more than one number must take the modal branch",
  );
  assert.ok(
    /label="Phone"/.test(PILLS),
    "the multi-number pill is labelled Phone — one pill, not one per number",
  );
  assert.ok(
    /phoneChoices\.length === 1/.test(PILLS),
    "exactly one number must take the direct-link branch",
  );
  assert.ok(
    /href=\{telHref\(phoneChoices\[0\]\.phone\)\}/.test(PILLS),
    "the single-number pill must be the tel: link itself, with no modal",
  );
  // The old shape, gone: no loop pushing one pill per number.
  assert.ok(
    !/for \(const \[index, office\] of districtPhones/.test(PILLS),
    "the per-number pill loop must not come back",
  );
});

test("the modal dials, dismisses, and leaves the card underneath alone", () => {
  assert.ok(
    /href=\{telHref\(choice\.phone\)\}/.test(MODAL),
    "every row must be a tel: link",
  );
  assert.ok(
    /role="dialog"[\s\S]{0,200}aria-modal="true"/.test(MODAL),
    "the chooser is a dialog",
  );
  assert.ok(
    /event\.key === "Escape"/.test(MODAL),
    "Escape must close it",
  );
  assert.ok(
    /event\.target === event\.currentTarget/.test(MODAL),
    "a backdrop press must close it, and a press on the panel must not",
  );
  // M90: the card behind must be untouched by the press that closes this.
  // `useDismissOnOutside` reads this attribute.
  assert.ok(
    /data-dismiss-exempt/.test(MODAL),
    "the overlay must be exempt from the battlecard's outside-press dismissal",
  );
  // M52: an overlay that pushes history gets its island remounted and dies.
  assert.ok(
    !/pushState|history\.push/.test(MODAL),
    "no history entry may be pushed",
  );
});

test("the chooser sits OVER the battlecard, and its rows stay tappable", () => {
  const overlay = CSS.match(/\.phone-modal-overlay \{[\s\S]*?\}/)?.[0] ?? "";
  const zIndex = Number(overlay.match(/z-index:\s*(\d+)/)?.[1]);
  const cardOverlay =
    CSS.match(/\.account-modal-overlay \{[\s\S]*?\}/)?.[0] ?? "";
  const cardZ = Number(cardOverlay.match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(zIndex) && Number.isFinite(cardZ));
  assert.ok(zIndex > cardZ, "the chooser must render above the battlecard");

  const row = CSS.match(/\.phone-modal-row \{[\s\S]*?\}/)?.[0] ?? "";
  assert.ok(
    /min-height:\s*44px/.test(row),
    "a chooser row below tap size has moved the defect, not fixed it",
  );
});
