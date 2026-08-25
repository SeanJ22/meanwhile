/**
 * `pnpm purge:synthetic` — REMOVE OUR OWN AUTOMATED ROWS FROM THE SOLD STORES.
 *
 * ## Why this exists
 *
 * `CLAUDE.md`'s probe-naming rule states the problem exactly: *these stores are
 * sold as reader signal, and a row a session created is plumbing wearing reader
 * clothes.* Naming them made them findable; `run_class` made them countable.
 * Neither removes them.
 *
 * Measured on production 2026-08-24, `search_log`: **260 organic against 11,755
 * synthetic** — reader signal is 1.7% of the table. Every walk, every capture
 * run and every `/api/meetings` GET a session ever made is in there beside it.
 *
 * ## What it deletes, and the three things it will not touch
 *
 * ONLY `run_class = 'SYNTHETIC'`. Three classes are deliberately left alone,
 * and each for its own reason:
 *
 * - **ORGANIC** — the readers. The whole point.
 * - **UNKNOWN** — rows that PREDATE the marker and cannot be attributed either
 *   way. 2,845 of them in the search log. They might be readers. Deleting a row
 *   because we cannot prove it is a reader is asserting it is not one, which is
 *   the absence-as-assertion failure pointed at a `DELETE`.
 * - **AUTHOR** — Sean's own use of his own product. His to keep.
 *
 * ## The discipline around a destructive production write
 *
 * - **Dry run by default.** `--apply` is required, and `--target=production`
 *   separately.
 * - **Exported first**, to a dated file outside the repo, exactly as the A-001
 *   migration was. A deletion whose rows exist nowhere else is not reversible.
 * - **Counted before and after, per class.** The report states every class, not
 *   only the one that moved — a purge that quietly took an ORGANIC row with it
 *   would be invisible in a report that only printed the synthetic count.
 * - **Feedback rows take their contact row with them.** A-001 put reader
 *   addresses in `feedback_contact` keyed by an opaque handle with no foreign
 *   key, so nothing in the database would cascade. Leaving the address behind
 *   would be a delete that kept the identifying half.
 *
 *   pnpm tsx scripts/purge-synthetic-rows.mts --target=production
 *   pnpm tsx scripts/purge-synthetic-rows.mts --target=production --apply
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";

import { today } from "./doc-dates.mjs";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
const APPLY = process.argv.includes("--apply");

// A destructive write needs the WRITE handle. A read-only string would fail
// halfway through with rows already exported, which is the worst ordering.
const variable = PRODUCTION ? "WTP_PRODUCTION_DATABASE_URL_WRITE" : "DATABASE_URL";
const connection = process.env[variable];
if (!connection) {
  console.error(`purge:synthetic: ${variable} is not set — refusing to guess`);
  process.exit(2);
}
const sql = neon(connection);

const STORES = ["search_log", "reactions", "feedback"] as const;
type Store = (typeof STORES)[number];

async function census(): Promise<Record<Store, Record<string, number>>> {
  const out = {} as Record<Store, Record<string, number>>;
  for (const store of STORES) {
    const rows = (await sql.query(
      `select run_class, count(*)::int as n from ${store} group by run_class order by run_class`,
    )) as { run_class: string; n: number }[];
    out[store] = Object.fromEntries(rows.map((r) => [r.run_class, r.n]));
  }
  return out;
}

function line(store: string, counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const part = (k: string) => `${k.toLowerCase()} ${counts[k] ?? 0}`;
  return `  ${store.padEnd(12)} ${["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"].map(part).join(" · ")} · TOTAL ${total}`;
}

const before = await census();

console.log(`\npurge:synthetic — ${variable}${APPLY ? "" : "   (DRY RUN — nothing will be deleted)"}\n`);
console.log("BEFORE");
for (const store of STORES) console.log(line(store, before[store]));

const toDelete = STORES.reduce((n, s) => n + (before[s].SYNTHETIC ?? 0), 0);
console.log(`\n  ${toDelete} SYNTHETIC row(s) across ${STORES.length} store(s).`);
console.log(
  "  ORGANIC, UNKNOWN and AUTHOR rows are not touched. UNKNOWN predates the marker\n" +
    "  and might be a reader; deleting it would assert it is not one.\n",
);

if (!APPLY) {
  console.log("  DRY RUN. Re-run with --apply to delete.\n");
  process.exit(0);
}

/* ------------------------------------------------------------- export --- */

const dir = resolve(import.meta.dirname, "..", "..", "wtp-backups");
mkdirSync(dir, { recursive: true });
const exported: Record<string, unknown[]> = {};
for (const store of STORES) {
  exported[store] = (await sql.query(
    `select * from ${store} where run_class = 'SYNTHETIC'`,
  )) as unknown[];
}
// The addresses behind any synthetic feedback row, so the export is complete.
exported.feedback_contact = (await sql.query(
  `select c.* from feedback_contact c
     join feedback f on f.contact_ref = c.contact_ref
    where f.run_class = 'SYNTHETIC'`,
)) as unknown[];

const file = join(dir, `synthetic-rows-${today()}-${PRODUCTION ? "production" : "local"}.json`);
writeFileSync(file, `${JSON.stringify({ exportedFrom: variable, rows: exported }, null, 2)}\n`, "utf8");
console.log(`  exported ${Object.values(exported).reduce((n, r) => n + r.length, 0)} row(s) to ${file}\n`);

/* ------------------------------------------------------------- delete --- */

/*
 * The contact rows go FIRST, and their own delete is scoped by the join rather
 * than by a list of handles read earlier — a handle read into memory and used
 * after the feedback rows are gone would be a list nothing could re-derive.
 */
const contactsGone = (await sql.query(
  `delete from feedback_contact
    where contact_ref in (select contact_ref from feedback where run_class = 'SYNTHETIC' and contact_ref is not null)
    returning contact_ref`,
)) as unknown[];
console.log(`  feedback_contact  ${contactsGone.length} address row(s) deleted with their feedback`);

for (const store of STORES) {
  const gone = (await sql.query(`delete from ${store} where run_class = 'SYNTHETIC' returning id`)) as unknown[];
  console.log(`  ${store.padEnd(12)}  ${gone.length} row(s) deleted`);
}

const after = await census();

console.log("\nAFTER");
for (const store of STORES) console.log(line(store, after[store]));

/* ------------------------------------------------------------- verify --- */

const problems: string[] = [];
for (const store of STORES) {
  if ((after[store].SYNTHETIC ?? 0) !== 0) {
    problems.push(`${store} still holds ${after[store].SYNTHETIC} synthetic row(s)`);
  }
  for (const kept of ["ORGANIC", "UNKNOWN", "AUTHOR"] as const) {
    if ((after[store][kept] ?? 0) !== (before[store][kept] ?? 0)) {
      problems.push(
        `${store}.${kept} moved from ${before[store][kept] ?? 0} to ${after[store][kept] ?? 0} — a class that must not have been touched`,
      );
    }
  }
}

console.log("");
if (problems.length > 0) {
  for (const p of problems) console.log(`  PROBLEM  ${p}`);
  process.exit(1);
}
console.log(
  `  every SYNTHETIC row is gone; ORGANIC ${before.search_log.ORGANIC ?? 0} of ` +
    `${before.search_log.ORGANIC ?? 0}, UNKNOWN and AUTHOR untouched in all three stores.\n`,
);
