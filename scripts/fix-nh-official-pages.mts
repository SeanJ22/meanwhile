/**
 * **THE STALE `?member=` FORM ON gc.nh.gov, SWEPT** (built 2026-08-21, NH Hunt
 * 4 item 1c).
 *
 * ```
 * pnpm nh:fix-pages [--write]
 * ```
 *
 * ## The named instance and its 74 siblings
 *
 * Removing the compiled `gc.nh.gov` skip on 2026-08-21 surfaced six genuine
 * page misses that a blanket "unverifiable" label had been hiding. One of them
 * was **Mary Jane Wallner**, a sitting New Hampshire state representative whose
 * stored page was `gc.nh.gov/house/members/member.aspx?member=368423` — a URL
 * shape the General Court no longer serves. Her real page is
 * `member.aspx?pid=411`, it answers at rung 2, and it publishes her email, her
 * phone and her district address.
 *
 * A named instance is an example of a class-wide defect. **75 of the 410 New
 * Hampshire officeholders carry the `?member=` form**; only one showed up as a
 * miss because only the 85 division-linked officials are audited at all. The
 * other 74 are latent, and every one of them would have read as an official
 * with no page the moment their seat was wired to a district.
 *
 * ## How it repairs a row, and what it refuses to do
 *
 * The General Court's own roster — `pnpm nh:legislator --list` — is the branch,
 * and it is independent of this registry. A row is repaired only when the
 * roster carries **exactly one** member whose name matches, normalised the same
 * way `lib/photos/person.ts` normalises a person key. **An ambiguous match is
 * left alone and REPORTED**, because writing the wrong legislator's page under
 * a named person is worse than leaving a stale URL: a stale URL fails visibly
 * and a wrong one does not.
 *
 * It prints found, repaired, ambiguous and unmatched, always. A run that
 * repairs nothing says so rather than exiting quietly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { personKey } from "../lib/photos/person.ts";
import { houseRoster, senateRoster } from "./nh-legislator.mts";

const WRITE = process.argv.includes("--write");
const FILE = join(process.cwd(), "lib", "registry", "officeholders-33.json");

interface Officeholder {
  id: string;
  name: string;
  officeTitle: string;
  websiteUrl: string | null;
  [key: string]: unknown;
}

const raw = JSON.parse(readFileSync(FILE, "utf8")) as
  | Officeholder[]
  | { officeholders: Officeholder[] };
const rows: Officeholder[] = Array.isArray(raw) ? raw : raw.officeholders;

const STALE = /member\.aspx\?member=/i;
const stale = rows.filter((r) => STALE.test(r.websiteUrl ?? ""));
console.log(`\nnh:fix-pages — ${rows.length} New Hampshire officeholder(s)`);
console.log(`  carrying the stale ?member= form: ${stale.length}`);

/** Both chambers, as ONE list of (name, page URL). */
const HOST = "https://www.gencourt.state.nh.us";
const house = await houseRoster();
const senate = await senateRoster();
const roster = [
  ...house.map((m) => ({ name: m.name, url: `${HOST}/house/members/member.aspx?pid=${m.pid}` })),
  ...senate.map((m) => ({ name: m.name, url: m.pageUrl })),
];
console.log(`  General Court roster read: ${roster.length} member(s) — ${house.length} House, ${senate.length} Senate`);

/**
 * The House roster writes `Aldrich, Glen` and this registry writes
 * `Glen Aldrich`. Keying both through `personKey` alone matched NOTHING —
 * 75 of 75 unmatched, which looked exactly like 75 former members and was
 * really one comma. The order is normalised before the key is taken.
 */
function nameKey(name: string): string {
  const flipped = /^([^,]+),s*(.+)$/.exec(name);
  return personKey(flipped ? `${flipped[2]} ${flipped[1]}` : name);
}

const byKey = new Map<string, { name: string; url: string }[]>();
for (const member of roster) {
  const key = nameKey(member.name);
  const list = byKey.get(key) ?? [];
  list.push({ name: member.name, url: member.url });
  byKey.set(key, list);
}

/**
 * The SECOND tier, and it exists because the first tier's 12 misses were not
 * former members — they were nicknames. This registry writes `Jim MacKay`,
 * `Sherm Packard` and `Tom Buco`; the roster writes `MacKay, James`,
 * `Packard, Sherman` and `Buco, Thomas`. A surname plus a first initial
 * settles those, and it is accepted ONLY when exactly one roster member
 * matches — an ambiguous surname is reported and left alone, because a wrong
 * page under a named person is worse than a stale one.
 */
const bySurname = new Map<string, { name: string; url: string }[]>();
for (const member of roster) {
  const flipped = /^([^,]+),s*(.+)$/.exec(member.name);
  const surname = personKey(flipped ? flipped[1] : (member.name.split(/s+/).pop() ?? ""));
  const first = personKey(flipped ? flipped[2] : member.name).charAt(0);
  const key = `${surname}|${first}`;
  const list = bySurname.get(key) ?? [];
  list.push(member);
  bySurname.set(key, list);
}
function surnameKeyOf(name: string): string {
  const parts = personKey(name).split(" ");
  return `${parts[parts.length - 1]}|${(parts[0] ?? "").charAt(0)}`;
}

let repaired = 0;
let repairedBySurname = 0;
const ambiguous: string[] = [];
const unmatched: string[] = [];
for (const row of stale) {
  let hits = byKey.get(nameKey(row.name)) ?? [];
  let viaSurname = false;
  if (hits.length === 0) {
    hits = bySurname.get(surnameKeyOf(row.name)) ?? [];
    viaSurname = hits.length > 0;
  }
  if (hits.length === 0) {
    unmatched.push(row.name);
    continue;
  }
  if (hits.length > 1) {
    ambiguous.push(`${row.name} — ${hits.length} roster members share this name`);
    continue;
  }
  if (WRITE) row.websiteUrl = hits[0].url;
  repaired += 1;
  if (viaSurname) {
    repairedBySurname += 1;
    console.log(`      surname match: registry "${row.name}" -> roster "${hits[0].name}"`);
  }
}

console.log(`  repaired:  ${repaired}  (${repaired - repairedBySurname} on the full name, ${repairedBySurname} on surname + first initial)`);
console.log(`  ambiguous: ${ambiguous.length}  (left alone — a wrong page is worse than a stale one)`);
for (const a of ambiguous) console.log(`      ${a}`);
console.log(`  unmatched: ${unmatched.length}  (not on the current roster; a former member is its own hunt)`);
for (const u of unmatched.slice(0, 20)) console.log(`      ${u}`);

if (WRITE && repaired > 0) {
  writeFileSync(FILE, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  console.log(`\n  written ${FILE}`);
} else if (!WRITE) {
  console.log("\n  dry run. Re-run with --write to repair.");
}
