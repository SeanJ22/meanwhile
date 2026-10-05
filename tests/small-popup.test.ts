import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * THE SMALL POPUP (item 4, 2026-08-16).
 *
 * The previous form was scattered and carried too much information. It
 * carried a name, a party pill, outlined chips (state, chamber, incumbent),
 * an office line, an in-seat date and a wrapped grid of up to ten contact
 * pills, inside 300px.
 *
 * Three things and nothing else: the name with its circle, the party as the
 * FILLED PILL, and the contact pills in one vertical column. More at the
 * bottom opens the large card, which is where everything removed still lives
 * — nothing was deleted, it moved one tap down.
 */

function code(path: string[]): string {
  return readFileSync(join(process.cwd(), ...path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const POPUP = code(["components", "map", "popup", "official-popup.tsx"]);
const IDENTITY = code(["components", "officials", "person-identity.tsx"]);
const PILLS = code(["components", "officials", "contact-pills.tsx"]);
const MODAL = code(["components", "map", "popup", "official-modal.tsx"]);

test("the small popup renders identity only — no role line, no chips, no in-seat", () => {
  assert.ok(
    /<PersonIdentity[\s\S]*?identityOnly/.test(POPUP),
    "the small popup must render the identity-only form",
  );
  assert.ok(
    !/identityChipsFor/.test(POPUP),
    "the outlined chips are large-card only",
  );

  // And identityOnly actually suppresses all three, rather than being a prop
  // that reads well and does nothing.
  assert.ok(
    /const until = identityOnly \? null : inSeatUntil/.test(IDENTITY),
    "identityOnly must suppress the in-seat line",
  );
  assert.ok(
    /const outlined = identityOnly \? \[\] : chips/.test(IDENTITY),
    "identityOnly must suppress the outlined chips",
  );
  assert.ok(
    /\{!identityOnly && \(\s*<p className="id-office">/.test(IDENTITY),
    "identityOnly must suppress the office role line",
  );
});

test("the party pill stays — it is banned from the list, not from the card", () => {
  // The pill is rendered unconditionally by the identity header, so
  // identityOnly must not reach it.
  assert.ok(
    /holder\.partyLabel && \(\s*<IdentityChip fill=\{partyColorVar\(holder\.partyLabel\)\}>/.test(
      IDENTITY,
    ),
    "the party must render as the filled identity chip on both card sizes",
  );
});

test("the contact pills stack in one column, primary channels only", () => {
  assert.ok(
    /<ContactPills[\s\S]*?layout="column"[\s\S]*?scope="primary"/.test(POPUP),
    "the small popup must run the column, primary-scope pill set",
  );
  // The large card keeps the full row — nothing was deleted, it moved.
  assert.ok(
    /<ContactPills holder=\{holder\} \/>/.test(MODAL),
    "the large card must keep the full contact row",
  );

  // "primary" really drops the extended social row, and really keeps the
  // reachable channels including X.
  assert.ok(
    PILLS.includes("if (!full && platform.id !== PRIMARY_SOCIAL_PLATFORM_ID) continue;"),
    "the primary scope must keep only the primary platform's pill",
  );
  for (const kept of [
    // R39 (2026-08-17) collapsed the per-number pills into one; the phone is
    // still a primary channel and still on the small popup, it just branches
    // on the COUNT now. tests/contact-phone.test.ts holds that rule.
    "phoneChoices.length > 1",
    "phoneChoices.length === 1",
    "if (holder.email)",
    "if (holder.contactFormUrl)",
    "if (holder.websiteUrl)",
    "if (holder.campaignUrl)",
  ]) {
    assert.ok(PILLS.includes(kept), `the primary scope must keep: ${kept}`);
  }

  // Absent channels are absent pills — never padded to make a column look
  // full. The equal-effort rule is about the HUNT, not the row length.
  assert.ok(
    /if \(pills\.length === 0\)/.test(PILLS),
    "an empty pill set must say so rather than render placeholders",
  );
});

test("More is the way down, and it is full width like the column", () => {
  const card = code(["components", "map", "popup", "popup-card.tsx"]);
  assert.ok(
    /onExpand && \(\s*<button[\s\S]*?className="popup-card-more mt-3 flex w-full/.test(
      card,
    ),
    "the More footer must stay full width beneath the column",
  );

  /*
   * F01 1.3 (2026-08-19): More stays locked at the bottom; a reader who just
   * wants to click More should never find it hidden.
   *
   * Full width was necessary and not sufficient: everything scrolled together
   * inside a `max-height: 55vh` card, so a district with five board members
   * pushed More off the bottom and the door to the large battlecard sat behind
   * a scroll. The card is three bands now, and the two that must not move say
   * so in CSS rather than relying on the flexbox default.
   */
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const shell = css.match(/\.popup-card \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(shell, /flex-direction: column/, "the card must be three bands");
  assert.match(shell, /overflow: hidden/, "the card itself must not be the scroller");
  assert.match(css, /\.popup-card-head,\s*\n\.popup-card-more \{\s*\n\s*flex-shrink: 0;/);
  assert.match(css, /\.popup-card-body \{[\s\S]*?overflow-y: auto;/);
  assert.ok(
    /onExpand=\{onExpand\}/.test(POPUP),
    "the small popup must offer the way into the large card",
  );
});
