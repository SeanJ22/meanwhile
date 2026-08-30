/**
 * `pnpm method:type-applicability` — populate typed applicability dimensions
 * from the evidence each route's own record already proves. (2026-08-30. NH287.)
 *
 * At v61 the store held 122 routes; 120 stated zero typed dimensions while 61
 * carried outcome records naming where they were walked and dozens carried the
 * hosts they were proven against. This run moves ONLY what evidence proves into
 * the typed fields, prints every written value beside the evidence line that
 * proved it, and leaves empty what nothing proves.
 *
 * It NEVER promotes portability (that is `pnpm method:promote-portability`,
 * with its own bars), never removes or overwrites a value, never bumps the
 * method version, and writes only through `writeMethodStore` — the one governed
 * write path — with the version it read as the precondition.
 *
 * **THE DEFAULT IS A DRY RUN.** `--write` applies; `--store <path>` proves the
 * run against a throwaway copy first.
 */

import { join } from "node:path";

import { runTypedApplicability } from "../../lib/method/type-applicability.ts";
import { flag, present } from "../cli-args.mts";
import { today } from "../doc-dates.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const STORE = flag(argv, "store") ?? join(ROOT, "data", "method", "knowledge.json");
const WRITE = present(argv, "write");

const run = runTypedApplicability(STORE, { stamp: today(), write: WRITE });
for (const line of run.lines) console.log(line);
