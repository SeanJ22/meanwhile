#!/usr/bin/env tsx
/**
 * **DOES EVERY SERVING SURFACE HAVE ITS STORE?**
 * (`pnpm db:surfaces` — the final pass, 2026-08-25, `NS15`'s mechanical half.)
 *
 * ```
 * pnpm db:surfaces                        # DATABASE_URL, the local branch
 * pnpm db:surfaces --target=production    # WTP_PRODUCTION_DATABASE_URL_READONLY
 * ```
 *
 * ## What it asks that nothing else did
 *
 * `pnpm db:check` compares migration TAGS, which is bookkeeping about which
 * files an applier recorded. This asks the server which TABLES it holds and maps
 * them to the surfaces a reader touches, so the failure message is not
 * *0020_dazzling_deathbird is missing* — it is **the Speak Your Mind box has
 * nowhere to write, and a reader's words are being accepted and dropped.**
 *
 * That is the sentence `NS15` needed and nobody could have produced, because
 * nothing connected a surface to its storage.
 *
 * ## READ ONLY, AND THE FOUR VERDICTS ARE KEPT APART
 *
 * It connects through the READONLY credential for production and issues one
 * catalog query. It can ask the question and has no way to answer it by applying
 * something — applying is `pnpm db:apply`, which resolves a different variable.
 *
 * Exit codes, because a check that cannot reach its subject must never print
 * like a passing one (RULING 24):
 *
 *   0  every serving surface has its store
 *   1  a surface is BROKEN — named, with what a reader experiences
 *   2  COULD NOT TELL — no credential, or the catalog would not answer
 *
 * `2` is not a pass. A deploy gate treating "could not tell" as green is the
 * false-green this whole file exists to end.
 */
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";

import { SERVING_SURFACES, brokenSurfaces, servingTables } from "../lib/db/serving-surfaces.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const target =
  process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length) ?? "local";
const envName = target === "production" ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";
const url = process.env[envName];

console.log(`\nSERVING SURFACES AGAINST THEIR STORES — ${target} (${envName})\n`);
console.log(`  surfaces declared   ${SERVING_SURFACES.length}`);
console.log(`  tables they need    ${servingTables().length}\n`);

if (!url) {
  console.error(
    `  COULD NOT TELL — ${envName} is not set, so nothing was asked and nothing is known.\n` +
      "  This is exit 2 and it is NOT a pass: a gate that reads an unanswerable question as green\n" +
      "  is the false-green NS15 was.",
  );
  process.exit(2);
}

let present: string[];
try {
  const sql = neon(url);
  const rows = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `) as { table_name: string }[];
  present = rows.map((r) => r.table_name);
} catch (e) {
  console.error(`  COULD NOT TELL — the catalog would not answer: ${(e as Error).message}`);
  process.exit(2);
}

/*
 * A catalog that answers with NOTHING is not a database with no tables — it is
 * a query that did not do what it was supposed to. RULING 43's zero-row shape,
 * in a gate.
 */
if (present.length === 0) {
  console.error(
    "  COULD NOT TELL — the catalog answered with zero tables. A database serving this product has\n" +
      "  tables, so this is a failed read rather than an empty schema.",
  );
  process.exit(2);
}

const broken = brokenSurfaces(present);
console.log(`  tables the server holds  ${present.length}`);
console.log(`  surfaces with their store ${SERVING_SURFACES.length - broken.length} of ${SERVING_SURFACES.length}\n`);

if (broken.length === 0) {
  console.log("  every serving surface has its store.");
  process.exit(0);
}

const worst: Record<string, string> = {
  ACCEPTS_AND_DROPS:
    "A READER'S INPUT IS ACCEPTED AND THEN SILENTLY LOST. This is the worst state this product has.",
  VISIBLE_ERROR: "The request errors visibly. Bad, and not deceptive.",
  RENDERS_EMPTY: "The surface renders empty.",
};
for (const { surface, missing } of broken) {
  console.error(`  BROKEN  ${surface.id}`);
  console.error(`          ${surface.reader}`);
  console.error(`          missing table(s): ${missing.join(", ")}`);
  console.error(`          ${worst[surface.effect]}`);
  console.error(`          served by ${surface.servedBy.join(", ")}`);
  console.error("");
}
console.error(
  `  ${broken.length} serving surface(s) have no store. Apply the committed migrations with\n` +
    "  `pnpm db:apply --target=production` before this deploys, or a reader meets the missing half.",
);
process.exit(1);
