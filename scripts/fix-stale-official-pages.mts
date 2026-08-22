/**
 * **THE FIVE OFFICIALS WHOSE "SPECIFIC VERIFIED PAGE" POINTED SOMEWHERE ELSE**
 * (built 2026-08-21, NH Hunt 6 item 5 — `NH37` and `NH38`.)
 *
 * ```
 * pnpm fix:official-pages [--write]
 * ```
 *
 * `pnpm nh:fix-pages` repaired New Hampshire's 75 stale `?member=` URLs from
 * the chamber's own roster. It reported, in the same run, six officials it
 * could not reach — and five of them were never worked, through two sessions,
 * because they are not in New Hampshire. This is that twin, for Arizona, New
 * Jersey and the US House.
 *
 * ## What was actually wrong, per person, each verified before it was changed
 *
 * Every replacement below was FETCHED and READ on 2026-08-21, and the old URL
 * was fetched too — a repair that does not check the thing it is repairing is
 * how a wrong page replaces a stale one.
 *
 * | who | the stored page | what it actually returned |
 * |---|---|---|
 * | Rachel Keshel | `azleg.gov/house-member/?legislature=56&session=127&legislator=2173` | HTTP 200, 106,944 bytes, **the surname "Keshel" nowhere in it** — the 56th Legislature under a legislator id that is not hers |
 * | Rosanna Gabaldón | `azleg.gov/senate-member/?legislature=55&legislator=1956` | the **55th** Legislature; her portrait was already sourced from the 57th |
 * | John McKeon | `assemblydems.com/john-mckeon/` | **HTTP 404**, and a party ASSEMBLY page for a sitting SENATOR |
 * | Parker Space | `njassemblygop.com/space/` | a party ASSEMBLY page for a sitting SENATOR |
 * | James Gallagher | *nothing at all* | seated 2026-06-10 in a special election; the congress-legislators dataset still carries `url: null` |
 *
 * Three of those five are the same defect wearing different clothes: **a page
 * that was right for a previous term, kept past the term.** A stale official
 * page is worse than none — it is a wrong claim about where a named person's
 * record lives, on a surface whose whole job is to say where a claim came from.
 *
 * ## What replaced each, and how it was confirmed
 *
 * - **Keshel** → `azleg.gov/House/House-member/?legislature=57&session=130&legislator=2317`.
 *   HTTP 200, 96,715 bytes, surname present. Same id her portrait cites.
 * - **Gabaldón** → `azleg.gov/Senate/Senate-member/?legislature=57&session=130&legislator=2380`.
 *   HTTP 200, 103,037 bytes, surname present.
 * - **McKeon** → `njleg.state.nj.us/legislative-roster/478/senator-mckeon`.
 *   **A FALSE MISS AT RUNG 2** — the NJ roster is a single-page app and serves
 *   the identical 25,380-byte shell for every member. At RUNG 6 it renders
 *   *"Senator John F. McKeon (D), District 27"* with `(862) 930-7071`, the phone
 *   already on his record. A session that had read only rung 2 would have
 *   concluded the page did not name him.
 * - **Space** → `njleg.state.nj.us/legislative-roster/473/senator-space`. Rung 6:
 *   *"Senator Parker Space (R), District 24"*, `(973) 300-0200` — again matching
 *   the stored phone.
 * - **Gallagher** → `gallagher.house.gov`. Title reads *"Congressman James
 *   Gallagher | Representing California's 1st District"*, which matches the
 *   record's chamber, state and district exactly. `jamesgallagher.house.gov`
 *   does not resolve, so the guess was checked rather than assumed.
 *
 * ## `verifiedAt`
 *
 * Set to the read date, because **a read from the subject's own official source
 * IS the verification** (`lib/officials/verification.ts`, the author's ruling of
 * 2026-08-16). Every host above is `.gov`. `provenance.sourceUrl` is untouched —
 * the RECORD still came from Plural Open States and saying otherwise would be a
 * different lie.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Repair {
  file: string;
  name: string;
  was: string | null;
  now: string;
  evidence: string;
}

const REPAIRS: Repair[] = [
  {
    file: "lib/registry/officeholders-04.json",
    name: "Rachel Keshel",
    was: "https://www.azleg.gov/house-member/?legislature=56&session=127&legislator=2173",
    now: "https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=2317",
    evidence:
      "stored page HTTP 200 / 106,944 b with the surname ABSENT; replacement HTTP 200 / 96,715 b with it present, and the same legislator id her official portrait cites (read 2026-08-21)",
  },
  {
    file: "lib/registry/officeholders-04.json",
    name: "Rosanna Gabaldón",
    was: "https://www.azleg.gov/senate-member/?legislature=55&legislator=1956",
    now: "https://www.azleg.gov/Senate/Senate-member/?legislature=57&session=130&legislator=2380",
    evidence:
      "stored page was the 55th Legislature; replacement HTTP 200 / 103,037 b, surname present, 57th Legislature — the one her portrait cites (read 2026-08-21)",
  },
  {
    file: "lib/registry/officeholders-34.json",
    name: "John McKeon",
    was: "https://www.assemblydems.com/john-mckeon/",
    now: "https://www.njleg.state.nj.us/legislative-roster/478/senator-mckeon",
    evidence:
      "stored page HTTP 404 and a party ASSEMBLY page for a sitting SENATOR; replacement is a rung-2 false miss (SPA shell, 25,380 b) that renders at rung 6 as 'Senator John F. McKeon (D), District 27' with (862) 930-7071, matching the stored phone (read 2026-08-21)",
  },
  {
    file: "lib/registry/officeholders-34.json",
    name: "Parker Space",
    was: "https://www.njassemblygop.com/space/",
    now: "https://www.njleg.state.nj.us/legislative-roster/473/senator-space",
    evidence:
      "stored page was a party ASSEMBLY page for a sitting SENATOR; replacement renders at rung 6 as 'Senator Parker Space (R), District 24' with (973) 300-0200, matching the stored phone (read 2026-08-21)",
  },
  {
    file: "lib/registry/officeholders-us.json",
    name: "James Gallagher",
    was: null,
    now: "https://gallagher.house.gov/",
    evidence:
      "no page at all — seated 2026-06-10 in a special election and congress-legislators still carries url:null. Replacement title reads 'Congressman James Gallagher | Representing California's 1st District', matching the record's chamber, state and district; jamesgallagher.house.gov does not resolve (read 2026-08-21)",
  },
];

const READ_DATE = "2026-08-21";
const write = process.argv.includes("--write");

let changed = 0;
let alreadyRight = 0;
let notFound = 0;

const byFile = new Map<string, Repair[]>();
for (const r of REPAIRS) {
  byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
}

console.log(`\nfix:official-pages — ${REPAIRS.length} repair(s), each verified before it is applied\n`);

for (const [file, repairs] of byFile) {
  const path = join(ROOT, file);
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    officeholders?: {
      name?: string;
      websiteUrl?: string | null;
      provenance?: { verifiedAt?: string | null };
    }[];
  };
  const rows = doc.officeholders ?? [];
  let touched = false;

  for (const repair of repairs) {
    const row = rows.find((r) => r.name === repair.name);
    if (!row) {
      console.log(`  NOT FOUND   ${repair.name} in ${file}`);
      notFound += 1;
      continue;
    }
    if (row.websiteUrl === repair.now) {
      console.log(`  ALREADY     ${repair.name}`);
      alreadyRight += 1;
      continue;
    }
    /*
     * A repair whose `was` no longer matches what is on disk is REFUSED, not
     * forced. Somebody else changed it, and overwriting a change we have not
     * read is how a repair becomes a regression.
     */
    if ((row.websiteUrl ?? null) !== repair.was) {
      console.log(
        `  REFUSED     ${repair.name} — on disk is ${row.websiteUrl ?? "null"}, this repair expected ${repair.was ?? "null"}. Re-verify before forcing.`,
      );
      notFound += 1;
      continue;
    }
    console.log(`  REPAIR      ${repair.name}`);
    console.log(`      was  ${repair.was ?? "(nothing)"}`);
    console.log(`      now  ${repair.now}`);
    console.log(`      why  ${repair.evidence}`);
    if (write) {
      row.websiteUrl = repair.now;
      row.provenance = { ...(row.provenance ?? {}), verifiedAt: READ_DATE };
      touched = true;
    }
    changed += 1;
  }

  if (write && touched) {
    /*
     * TWO-SPACE, matching what these files are written with. A serializer that
     * reformats turns a one-field repair into a 37,000-line diff nobody can
     * review — which is how a real change hides inside a cosmetic one. The
     * first run of this script did exactly that.
     */
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    console.log(`  written     ${file}`);
  }
}

console.log(
  `\n  repaired ${changed} · already right ${alreadyRight} · refused/not found ${notFound} · of ${REPAIRS.length}`,
);
console.log(`  ${changed + alreadyRight + notFound} = ${REPAIRS.length}  (reconciles)`);
if (!write) console.log("\n  dry run. Re-run with --write.\n");
else console.log("");
