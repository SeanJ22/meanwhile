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
import { readAuditWeek, readLatestLookPasses } from "../lib/control-plane/live-audit-log.ts";
import { controlPlaneUrlFromEnv, createPgRepositories, placeReadConnection } from "../lib/control-plane/repository/pg-store.ts";
import { addUpdates } from "../lib/control-plane/updates.ts";
import { auditReadings, doorReadings, holdReadings, lookReadings, placeTraitsFrom } from "../lib/method/loss-readings.ts";
import { readLossCheckerItems, readLossObligationStudies } from "../lib/method/loss-study-counts.ts";
import type { DoorLike } from "../lib/method/loss-readings.ts";
import type { RecordProjection, Persisted, PassCursor } from "../lib/control-plane/repository/types.ts";
import { LOSS_KIND_WORDS, lessonKinds, lossLessonUpdates, lossStudyLessons, studyAllLosses } from "../lib/method/study-all-losses.ts";


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
const doorFields: RecordProjection = { kind: true, ocdId: true, holds: true, status: true, updatedAt: true, shutSince: true };
const doors = await read("doors", async () => (await (repos.doors.currentRecords
  ? repos.doors.currentRecords(doorFields) : repos.doors.listNarrowed(doorFields))).map(row => row.value as DoorLike), []);
const cursorId = "loss-study:obligations";
const cursor = await repos.passCursors.readNarrowed(cursorId, { through: true }) as Persisted<PassCursor> | null;
const obligationStudy = await read<Awaited<ReturnType<typeof readLossObligationStudies>> | null>("hunts", async () => {
  const sql = placeReadConnection(repos);
  if (!sql) throw new Error("The loss-study count reader is unavailable");
  return readLossObligationStudies(sql, cursor?.value.through ?? null, now);
}, null);
const items = await read("checker holds", async () => {
  const sql = placeReadConnection(repos);
  if (!sql) throw new Error("The loss-study checker reader is unavailable");
  return readLossCheckerItems(sql);
}, []);
const audits = await read("auditors' red flags", async () => (await readAuditWeek(repos, now)).results, []);
const looks = await read("front-end red flags", () => readLatestLookPasses(repos, 7), []);

const readings = [...doorReadings(doors), ...holdReadings(items), ...auditReadings(audits), ...lookReadings(looks)];
/* With nothing read there is no population to study; "0 lessons from 0 losses" would be a false all-clear. */
if (readings.length === 0 && (obligationStudy?.readings ?? 0) === 0) {
  console.error(`loss study: no doors, hunts, holds or red flags were read${unread.length ? ` (not read: ${unread.join(", ")})` : ""}; nothing was measured`);
  process.exit(1);
}
const traits = placeTraitsFrom({ doors, items, places: readings.map((r) => r.placeId) });
const lessons = [...studyAllLosses(readings, traits, now), ...lossStudyLessons(obligationStudy?.studies ?? [], now)];
let saved = true;

if (DRY) {
  for (const l of lessons) console.log(`  ${l.says}`);
} else if (lessons.length) {
  const written = await writeFieldManual(repos, lessons.map((l) => l.entry), now);
  if (written.error) { saved = false; console.error(`loss study: the field manual could not be written (${written.error})`); }
  await addUpdates(repos, lossLessonUpdates(lessons, now), now);
}
if (!DRY && saved && unread.length === 0 && obligationStudy) {
  const next = { through: new Date(Date.parse(obligationStudy.through) - 120_000).toISOString() };
  if (cursor) await repos.passCursors.compareAndSet(cursorId, cursor.revision, next, now);
  else await repos.passCursors.put(cursorId, next, now);
}
const kinds = lessonKinds(lessons).map((k) => LOSS_KIND_WORDS[k]);
console.log(`loss study: ${lessons.length} lessons from ${readings.filter((r) => r.failed).length + (obligationStudy?.failures ?? 0)} losses${kinds.length ? ` (${kinds.join(", ")})` : ""}${unread.length ? `; not read: ${unread.join(", ")}` : ""}`);
