#!/usr/bin/env node
/**
 * **ONE STUDY OF EVERY KIND OF LOSS.**
 *
 * Reads shut doors, standing empty hunts, checker holds, the week's auditors'
 * red flags and the latest look checks' red flags, studies each kind the way
 * method failures are studied (lib/method/study-all-losses.ts), and writes each
 * lesson to the field manual (one entry per kind, subject and cause, so a
 * repeat study updates it) and to Admin's updates (once per lesson, so Now
 * shows it once). Plain code, no model.
 *
 * Runs on the runner host once a day:
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/loss-study-pass.mts [--dry-run]
 *
 * `--dry-run` reads and prints the lessons without writing anything. Exit 0
 * with a one-line summary; exit 1 when the control plane is not configured.
 */
import { writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { addUpdates } from "../lib/control-plane/updates.ts";
import { LOSS_KIND_WORDS, LOSS_KINDS, lossLessonUpdates, type LossKind } from "../lib/method/study-all-losses.ts";
import { runLossStudy } from "../lib/method/loss-study-run.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const DRY = process.argv.includes("--dry-run");
const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url) {
  console.error("loss study: the control plane is not configured; nothing was studied");
  process.exit(1);
}
const repos = await createPgRepositories(url, now, { skipBootstrap: true });

const kinds = new Set<LossKind>();
const out = await runLossStudy(repos, now, async lesson => {
  kinds.add(lesson.kind);
  if (DRY) console.log(`  ${lesson.says}`);
  else {
    const written = await writeFieldManual(repos, [lesson.entry], now);
    if (written.error) console.error(`loss study: the field manual could not be written (${written.error})`);
    await addUpdates(repos, lossLessonUpdates([lesson], now), now);
  }
});
/* With nothing read there is no population to study; "0 lessons from 0 losses" would be a false all-clear. */
if (out.readings === 0) {
  console.error(`loss study: no doors, hunts, holds or red flags were read${out.unread.length ? ` (not read: ${out.unread.join(", ")})` : ""}; nothing was measured`);
  process.exit(1);
}
const words = LOSS_KINDS.filter(kind => kinds.has(kind)).map(kind => LOSS_KIND_WORDS[kind]);
console.log(`loss study: ${out.lessons} lessons from ${out.failures} losses${words.length ? ` (${words.join(", ")})` : ""}${out.unread.length ? `; not read: ${out.unread.join(", ")}` : ""}`);
