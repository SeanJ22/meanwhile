/**
 * **SEEDING THE CITATION LEDGER FROM THE WALKS THIS REPOSITORY ALREADY TOOK.**
 * (2026-09-01, run once.)
 *
 * `lib/hunt/citation-ledger.ts` exists because a citation CONFIRMED on one walk
 * and UNREACHABLE on the next was arriving downstream indistinguishable from one
 * that was never proved — and a sitting mayor left the reader's page when a
 * borough dropped a `www` from its hostname.
 *
 * The ledger is append-only and is written only from live `CONFIRMED` verdicts.
 * That leaves one problem the mechanism cannot solve for itself: **every
 * confirmation taken before it existed is in an artifact that gets
 * overwritten.** Starting empty would mean the first walk after this change
 * carries nothing, which is the same data loss arriving through the fix.
 *
 * So the ledger is seeded from the walk artifacts in git history — each row
 * dated to the walk that actually took it, never to today. Nothing is invented:
 * a row appears only where a committed artifact records `verdict: CONFIRMED`
 * with the URL that confirmed it.
 *
 *   pnpm tsx scripts/seed-citation-ledger.mts            dry run
 *   pnpm tsx scripts/seed-citation-ledger.mts --write
 */

import { execFileSync } from "node:child_process";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import {
  CITATION_LEDGER_PATH,
  mergeConfirmations,
  readCitationLedger,
  writeCitationLedger,
} from "../lib/hunt/citation-ledger.ts";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");
const ARTIFACT = "data/hunt/wikipedia-nj-morris.json";

interface WalkArtifact {
  walkedAt?: string;
  municipalities?: {
    citationChecks?: { person: string; verdict: string; confirmedBy: string | null }[];
  }[];
}

/** Every revision of the walk artifact, oldest first. */
function revisions(): string[] {
  const out = execFileSync("git", ["log", "--format=%H", "--", ARTIFACT], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean).reverse();
}

function readAt(sha: string): WalkArtifact | null {
  try {
    const text = execFileSync("git", ["show", `${sha}:${ARTIFACT}`], {
      cwd: ROOT,
      encoding: "utf8",
      /* The artifact is megabytes. The default 1 MB buffer THROWS, and a
         catch-all would turn that into a false "this revision had none". */
      maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(text) as WalkArtifact;
  } catch {
    return null;
  }
}

const shas = revisions();
let ledger = readCitationLedger(ROOT);
let totalAdded = 0;
const perRevision: string[] = [];

for (const sha of shas) {
  const art = readAt(sha);
  if (!art) continue;
  const walkedAt = art.walkedAt;
  if (!walkedAt) continue;

  const confirmations = (art.municipalities ?? []).flatMap((m) =>
    (m.citationChecks ?? [])
      .filter((c) => c.verdict === "CONFIRMED" && c.confirmedBy)
      .map((c) => ({ person: c.person, url: String(c.confirmedBy) })),
  );
  if (confirmations.length === 0) continue;

  /*
   * Dated to the walk that took it, oldest revision first, so
   * `firstConfirmedOn` is genuinely first rather than whichever revision this
   * loop happened to reach.
   */
  const merged = mergeConfirmations(ledger, confirmations, walkedAt, `wiki:muni@${sha.slice(0, 12)}`);
  ledger = merged.ledger;
  totalAdded += merged.added;
  perRevision.push(
    `${sha.slice(0, 12)} walked ${walkedAt}: ${confirmations.length} confirmed, ${merged.added} new`,
  );
}

const seeded = floored(
  "confirmations seeded from committed walk artifacts",
  `git history of ${ARTIFACT}`,
  shas.length,
  perRevision.length,
);

if (WRITE) writeCitationLedger(ROOT, ledger);

console.log(`\ncitation ledger seed — ${WRITE ? "WRITTEN" : "DRY RUN"}`);
console.log(`  ${floorLine(seeded)}`);
console.log(`  rows now held            ${ledger.rows.length}`);
console.log(`  rows added by this run   ${totalAdded}`);
for (const line of perRevision) console.log(`    ${line}`);
console.log(`  ledger                   ${CITATION_LEDGER_PATH}`);
if (!WRITE) console.log("\n  nothing written — pass --write");
