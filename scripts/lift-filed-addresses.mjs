/**
 * Lift the 47 filed mailing addresses out of prose and onto the card
 * (RULING 54, NH Hunt 3, 2026-08-21; `NH12`).
 *
 * The New Hampshire Secretary of State publishes a mailing address for every
 * candidate on the ballot. All 47 on Newbury's ballot were hunted, recorded,
 * and then written into a `note` field that nothing renders — so the product
 * held the only working contact for about half of them and showed none.
 *
 * This reads the recorded prose and writes `filedAddress` and
 * `filedAddressSource` onto each card. It invents nothing: a card whose note
 * carries no `FILED CONTACT:` sentence gets nulls, and a null renders as
 * nothing at all per RULING 28.
 *
 * Run once:
 *   node scripts/lift-filed-addresses.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), "data", "ballot", "candidate-cards-2026.json");
const file = JSON.parse(readFileSync(FILE, "utf8"));

/*
 * The recorded shape is `FILED CONTACT: <address> (<source>).` or
 * `FILED CONTACT: <address>, from <source>.` — both forms are in the data,
 * because they were written by hand across two sessions.
 *
 * The address ends at the first sentence boundary that is followed by a
 * SPACE and a CAPITALISED KEYWORD, because addresses themselves contain
 * periods ("PO Box 149, Hopkinton NH 03229-0149. CAMPAIGN SITE: ...").
 */
/*
 * **ANCHOR ON THE ZIP, NOT ON A PERIOD.** The first version of this cut the
 * address at the first `.` and lifted 4 of 47, because these sentences carry
 * periods inside them and because the source clause takes two different shapes
 * ("(Secretary of State 2026 filing)" and ", from the same roster …") written
 * by hand across two sessions.
 *
 * Every one of the 47 ends `<City> NH <zip>`, optionally +4. That is an
 * unambiguous terminator, and anchoring on it means the parse does not depend
 * on prose punctuation at all. A record that does NOT end that way is not
 * force-matched — it is reported as unparsed, because a half-read address is a
 * wrong address under a named person's name.
 */
const FILED = /FILED CONTACT(?:\s*\(state\))?:\s*(.+?\bNH\s+\d{5}(?:-\d{4})?)/;
/** The source clause, where the note names one. */
const FILED_SOURCE = /\bNH\s+\d{5}(?:-\d{4})?\s*(?:\(([^)]+)\)|,\s*from\s+([^.]+))/;

let lifted = 0;
let noSource = 0;
const missing = [];

for (const [key, card] of Object.entries(file.cards)) {
  /*
   * **ALL the notes for this key, not the first one.**
   *
   * `hunts` holds 175 records against 92 cards — a candidate accumulates one
   * per hunt rung walked across several sessions. The first version of this
   * used `.find`, which silently returns whichever record happens to be
   * earliest, and lifted 4 addresses of 47: for 43 people the first record was
   * a different rung's note and the address sat in the second or third.
   *
   * That is `CLAUDE.md`'s collapsing-join shape exactly — a lookup that can
   * match several rows quietly answering with one — and it produced a clean
   * exit and a wrong number, which is why the count is printed and checked
   * against the 47 known to exist.
   */
  const notes = file.hunts.filter((h) => h.key === key).map((h) => h.note ?? "");
  const prose = `${notes.join(" ")} ${card.note ?? ""}`;
  const m = FILED.exec(prose);
  if (!m) {
    if (card.filedAddress === undefined) {
      card.filedAddress = null;
      card.filedAddressSource = null;
    }
    missing.push(key);
    continue;
  }
  const address = m[1].trim().replace(/\s+/g, " ");
  const sm = FILED_SOURCE.exec(prose);
  const source = (sm?.[1] ?? sm?.[2] ?? "").trim();
  card.filedAddress = address;
  // No source means no claim about where it came from — and a contact without
  // its source class is a generated claim. Default to the one filing every one
  // of these came from, named explicitly rather than left blank.
  if (!source) noSource += 1;
  card.filedAddressSource = source || "New Hampshire Secretary of State, 2026 candidate filing";
  lifted += 1;
}

console.log("filed-address lift (RULING 54):");
console.log(`  cards read              ${Object.keys(file.cards).length}`);
console.log(`  addresses lifted        ${lifted}`);
console.log(`  lifted with no explicit source phrase (defaulted, named): ${noSource}`);
console.log(`  cards with no filed address recorded: ${missing.length}`);

/*
 * An operation that can return nothing must be asked what it returned — and
 * here it can also return TOO FEW, which is the failure that actually happened.
 * The denominator is knowable: count the `FILED CONTACT` sentences in the file.
 * Lifting fewer than exist is a broken parse or a collapsed join, never a
 * shortage of addresses.
 */
const recorded = file.hunts.filter((h) => /FILED CONTACT/.test(h.note ?? "")).length;
console.log(`  FILED CONTACT sentences in the file: ${recorded}`);
if (lifted < recorded) {
  console.error(
    `REFUSED: lifted ${lifted} of ${recorded} recorded addresses. A partial lift is a ` +
      "broken parse or a collapsed join, and shipping it would render a contact for " +
      "some candidates and not others on no principle at all.",
  );
  process.exit(1);
}

writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8");

const back = JSON.parse(readFileSync(FILE, "utf8"));
const withAddress = Object.values(back.cards).filter((c) => c.filedAddress).length;
console.log(`  re-read, cards carrying an address: ${withAddress}`);
if (withAddress !== lifted) {
  console.error("REFUSED: the file did not read back with the same count.");
  process.exit(1);
}

// The two the ruling names by hand, confirmed rather than assumed.
for (const who of ["Donnelly", "Rusis"]) {
  const hit = Object.entries(back.cards).find(([k]) => k.toLowerCase().includes(who.toLowerCase()));
  console.log(`  ${who}: ${hit ? (hit[1].filedAddress ?? "NO ADDRESS") : "NO CARD FOUND"}`);
}
