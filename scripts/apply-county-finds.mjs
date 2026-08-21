/**
 * Apply what the Merrimack County branch found (NH Hunt 3, 2026-08-21, item 6).
 *
 * `pnpm nh:county` walks the county's own site — one branch, independent of the
 * Secretary of State's filings, of the General Court's roster and of our own
 * registry — and it serves six contests at once. These are the fields it
 * produced, each with the page that carries it.
 *
 * Every value here was read off the county's own page on 2026-08-21 and is
 * recorded with that date. Nothing is inferred and nothing is carried over from
 * a search result.
 *
 * Run once:  node scripts/apply-county-finds.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), "data", "ballot", "candidate-cards-2026.json");
const file = JSON.parse(readFileSync(FILE, "utf8"));

const DEEDS_DIR =
  "https://www.merrimackcounty.net/departments/register_of_deeds/staff_directory.php";
const ATTY_DIR =
  "https://www.merrimackcounty.net/departments/county_attorney/staff_directory.php";

/**
 * What changed, per candidate, and the page it came from.
 *
 * `phone` and `email` here are OFFICE contacts for a sitting officeholder,
 * which is what reaching that person in the office they hold actually means.
 * They are not personal numbers and are not presented as any.
 */
const FINDS = [
  {
    key: "ballot-nh-merrimack:register-of-deeds:morse-samantha",
    name: "Samantha Morse",
    set: {
      email: "Deeds@Merrimackcounty.net",
      phone: "603-228-0101",
    },
    note:
      "COUNTY BRANCH, walked 2026-08-21 (pnpm nh:county). Merrimack County's own " +
      "Register of Deeds staff directory names her as the REGISTER — the office " +
      "she is standing for — in its own words: 'Samantha Morse (Register)'. " +
      `SPECIFIC VERIFIED PAGE: ${DEEDS_DIR}, read 2026-08-21 at rung 2, HTTP 200. ` +
      "CONTACT: the Registry's published office email and phone, from the office " +
      "page on the same host. PHOTO: REFUSED, and the refusal is the finding — " +
      "the only image the county publishes of her is a GROUP PHOTOGRAPH of six " +
      "staff, captioned left to right. A group shot is prohibited at every door " +
      "of the photo rule and the composition standards never move, so this is a " +
      "branch result under RULING 52 and not a permanent absence: a solo portrait " +
      "may exist elsewhere and the hunt continues. BRANCH INDEPENDENT of the " +
      "Secretary of State filing already recorded for her.",
  },
  {
    key: "ballot-nh-merrimack:county-attorney:hagaman-meg",
    name: "Meg Hagaman",
    set: {
      phone: "603-228-0529",
    },
    note:
      "COUNTY BRANCH, walked 2026-08-21 (pnpm nh:county). The Merrimack County " +
      "Attorney's own staff directory lists her twice, by her full name and her " +
      "roles: 'Meghan Hagaman — County Solicitor' and 'Meghan Hagaman — Assistant " +
      "County Attorney'. She is standing for County Attorney, and this is the " +
      "office's own record of her in it. SPECIFIC VERIFIED PAGE: " +
      `${ATTY_DIR}, read 2026-08-21 at rung 2, HTTP 200. CONTACT: the County ` +
      "Attorney's published office phone, from the office page on the same host — " +
      "an office number for a serving officer, never presented as a personal one. " +
      "PHOTO: still owed; the directory is a table of names and roles and carries " +
      "no portraits at all. BRANCH INDEPENDENT of our officeholder registry, " +
      "which is what makes it worth having: the registry's exact-name join is " +
      "what produced 87 wrong 'no official page' records this session.",
  },
];

let updated = 0;
const missing = [];

for (const find of FINDS) {
  const card = file.cards[find.key];
  if (!card) {
    missing.push(find.key);
    continue;
  }
  for (const [field, value] of Object.entries(find.set)) {
    // Never overwrite something already found. A branch that confirms an
    // existing value adds confidence, not a replacement — and where two
    // branches DISAGREE that is a finding, not something to resolve quietly.
    if (card[field]) {
      console.log(`  kept existing ${find.name}.${field} = ${card[field]} (branch agreed or differed — not overwritten)`);
      continue;
    }
    card[field] = value;
    updated += 1;
  }
  file.hunts.push({
    key: find.key,
    name: find.name,
    note: find.note,
    attemptedAt: "2026-08-21",
  });
}

console.log("county finds:");
console.log(`  candidates targeted   ${FINDS.length}`);
console.log(`  fields written        ${updated}`);
console.log(`  cards not found       ${missing.length}${missing.length ? ` — ${missing.join(", ")}` : ""}`);

// An operation that can return nothing must be asked what it returned.
if (missing.length > 0) {
  console.error("REFUSED: a targeted card does not exist. Nothing written.");
  process.exit(1);
}

writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8");

const back = JSON.parse(readFileSync(FILE, "utf8"));
console.log(`  re-read, hunts now    ${back.hunts.length}`);
for (const find of FINDS) {
  const c = back.cards[find.key];
  console.log(`  ${find.name}: email=${c.email ?? "-"} phone=${c.phone ?? "-"}`);
}
