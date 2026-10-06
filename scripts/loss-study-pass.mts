#!/usr/bin/env node
/**
 * **ONE STUDY OF EVERY KIND OF LOSS.** (DP-29.)
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
import { readAuditWeek, readLatestLookPasses } from "../lib/control-plane/live-audit-log.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { addUpdates } from "../lib/control-plane/updates.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { absenceReadings, auditReadings, doorReadings, holdReadings, lookReadings, placeTraitsFrom } from "../lib/method/loss-readings.ts";
import { LOSS_KIND_WORDS, lessonKinds, lossLessonUpdates, studyAllLosses } from "../lib/method/study-all-losses.ts";

const DRY = process.argv.includes("--dry-run");
const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url) {
  console.error("loss study: the control plane is not configured; nothing was studied");
  process.exit(1);
}
const repos = await createPgRepositories(url, now, { skipBootstrap: true });

// Each source is read on its own; one that cannot be read is named and left out, never counted as no losses.
const unread: string[] = [];
const read = async <T,>(what: string, f: () => Promise<T>, empty: T): Promise<T> => {
  try { return await f(); } catch { unread.push(what); return empty; }
};
const doors = await read("doors", async () => (await listDoors(repos.doors)).doors, []);
const obligations = await read("hunts", async () => (await repos.obligations.list()).map((r) => r.value), []);
const items = await read("checker holds", async () => [
  ...(await repos.workItems.listWhere(["publicationOutcome", "status"], "HELD")),
  ...(await repos.workItems.listWhere(["publicationOutcome", "status"], "PUBLISHED")),
].map((r) => r.value), []);
const audits = await read("auditors' red flags", async () => (await readAuditWeek(repos, now)).results, []);
const looks = await read("front-end red flags", () => readLatestLookPasses(repos, 7), []);

const readings = [...doorReadings(doors), ...absenceReadings(obligations, now), ...holdReadings(items), ...auditReadings(audits), ...lookReadings(looks)];
const traits = placeTraitsFrom({ doors, items, places: readings.map((r) => r.placeId) });
const lessons = studyAllLosses(readings, traits, now);

if (DRY) {
  for (const l of lessons) console.log(`  ${l.says}`);
} else if (lessons.length) {
  const written = await writeFieldManual(repos, lessons.map((l) => l.entry), now);
  if (written.error) console.error(`loss study: the field manual could not be written (${written.error})`);
  await addUpdates(repos, lossLessonUpdates(lessons, now), now);
}
const kinds = lessonKinds(lessons).map((k) => LOSS_KIND_WORDS[k]);
console.log(`loss study: ${lessons.length} lessons from ${readings.filter((r) => r.failed).length} losses${kinds.length ? ` (${kinds.join(", ")})` : ""}${unread.length ? `; not read: ${unread.join(", ")}` : ""}`);
