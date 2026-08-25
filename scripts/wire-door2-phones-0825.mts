#!/usr/bin/env tsx
/**
 * @freshness-reads-here
 *
 * RULING 107 — the `phoneSource` sentence carries the date the page was read,
 * taken from the door-2 walk's own record of that read rather than from a clock
 * call here.
 */
/**
 * **THE DOOR-2 PHONES, ONTO THE CARDS.**
 * (The final pass, 2026-08-25. The phone half of `pnpm door2`.)
 *
 * ```
 * pnpm wire:phones          # report what would change
 * pnpm wire:phones --write
 * ```
 *
 * ## Why the phones ship and the portraits do not, in the same breath
 *
 * They came off the same document and they are not the same kind of claim. A
 * phone number a town publishes beside a named council member is a FACT with a
 * source, and it is checkable by dialling it. A portrait is a picture of a
 * person's face, and this project's standing rule is that a candidate photo
 * queues for the author and ships when he says so — because the failure mode is
 * a WRONG FACE next to a real person's name, and no amount of name-matching
 * makes that reversible after it renders.
 *
 * So `pnpm door2` writes a queue and ships nothing; this ships the phones and
 * touches no image.
 *
 * ## The number is read from the passage around the person's name
 *
 * A municipal page carries the clerk's number, the police number and the tax
 * office's, and the first digit run on it belongs to none of the people listed.
 * The walk reads the window around the surname; this refuses any row where that
 * window was not found, rather than accepting a page-level number.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");

const CARDS = join(ROOT, "data", "ballot", "candidate-cards-2026.json");
const cards = JSON.parse(readFileSync(CARDS, "utf8")) as {
  curatedAt: string;
  cards: Record<string, Record<string, unknown>>;
};

const walkPath = process.argv.find((a) => a.startsWith("--walk="))?.slice(7) ??
  join(ROOT, "data", "photos", "door2-incumbents-2026-08-25.json");
const walk = JSON.parse(readFileSync(walkPath, "utf8")) as {
  walkedAt: string;
  rows: {
    candidacyId: string;
    subject: string;
    bodyName: string;
    page: string | null;
    status: number;
    phone: string | null;
    phoneAlreadyHeld: boolean;
    attemptedAt: string;
  }[];
};

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8")) as {
  candidacies: { id: string }[];
};
const onBallot = new Set(ballot.candidacies.map((c) => c.id));

const changes = walk.rows.filter(
  (r) => r.phone && !r.phoneAlreadyHeld && r.status === 200 && r.page && onBallot.has(r.candidacyId),
);
const refused = walk.rows.filter((r) => r.phone && !r.phoneAlreadyHeld && !onBallot.has(r.candidacyId));

console.log(`\nDOOR-2 PHONES ONTO THE CARDS — read ${walk.walkedAt}\n`);
console.log(`  rows in the walk            ${walk.rows.length}`);
console.log(`  carrying a NEW phone        ${changes.length}`);
console.log(`  refused, not on the ballot  ${refused.length}`);
for (const r of refused) console.log(`    ${r.candidacyId} (${r.subject})`);
if (refused.length > 0) {
  console.error("\n  REFUSING TO WRITE — a row does not resolve to a candidacy on the committed ballot.");
  process.exit(1);
}
console.log("");
for (const r of changes) console.log(`  ${r.subject.padEnd(26)} ${r.phone}   ${r.page}`);

const before = Object.values(cards.cards).filter((c) => c.phone).length;
if (!WRITE) {
  console.log(`\n  cards with a phone today   ${before}`);
  console.log("  report only — pass --write to wire these onto the cards");
  process.exit(0);
}

for (const r of changes) {
  /*
   * A NEW ROW CARRIES THE WHOLE SHAPE, and its absent fields are `null`.
   *
   * The first version wrote `{ phone }` onto candidacies that had no card at
   * all, and every consumer that asks `card.photoUrl !== null` then read
   * `undefined` as a photo. `null` is "we looked and there is none"; missing
   * is "nobody has said", and the two are not interchangeable anywhere here.
   */
  const card = cards.cards[r.candidacyId] ?? {
    photoUrl: null,
    photoSource: null,
    bio: null,
    bioSourceUrl: null,
    bioSourceLabel: null,
    phone: null,
    email: null,
  };
  card.phone = r.phone;
  card.phoneSource =
    `published by ${r.bodyName.replace(/_/g, " ")} beside this member on its own site, ` +
    `read ${r.attemptedAt} — ${r.page}`;
  cards.cards[r.candidacyId] = card;
}
cards.curatedAt = walk.walkedAt;
const after = Object.values(cards.cards).filter((c) => c.phone).length;
writeFileSync(CARDS, `${JSON.stringify(cards, null, 2)}\n`, "utf8");

console.log(`\n  COLLECTION AND RENDERING, AS A PAIR:`);
console.log(`    phones found by the walk   ${changes.length}`);
console.log(`    cards with a phone         ${before} -> ${after}`);
console.log(`\n  written ${CARDS}`);
