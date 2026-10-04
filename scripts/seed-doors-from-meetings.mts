/**
 * DB-10 and DB-11: the one-time import of today's meeting doors and non-meeting feed doors into the Door Registry.
 *
 * Dry run by default: it says what it would add and writes nothing. `--apply`
 * writes, through the same upsert every derive step uses, so running it twice
 * changes nothing and a hand edit newer than the wiring is never overwritten.
 * `--file-store=<dir>` targets a file-backed control plane (proofs and tests).
 * A store that cannot be opened refuses; it never reports an empty import.
 *
 * Derived rows come from the promoted meeting-source wiring. When that cannot
 * be read, the hand-wired doors are still imported and the script says plainly
 * that the derived ones were not.
 */

import { readDerivedMeetingWiring } from "../lib/civic-data/derived-meeting-wiring.ts";
import { openControlPlane } from "../lib/control-plane/admin-data.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { feedDoorDrafts, seedFeedDoors } from "../lib/doors/seed-feeds.ts";
import { doorFromDerivedRecord, doorsFromWiringRow, seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import type { DerivedWiringRecord } from "../lib/civic-data/derived-meeting-wiring.ts";

const FLAGS = new Map<string, string>(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const eq = a.indexOf("=");
    return eq < 0 ? [a.slice(2), ""] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const say = (line: string): void => console.log(`doors:seed-meetings · ${line}`);

async function open(): Promise<ControlPlaneRepositories> {
  const store = FLAGS.get("file-store");
  if (store) return createFileRepositories(store);
  const opened = await openControlPlane();
  if (!opened.ok) {
    say(`REFUSED — ${opened.detail}`);
    process.exit(1);
  }
  return opened.repos;
}

const now = new Date().toISOString();
const repos = await open();
say(repos.describe());

let derived: readonly DerivedWiringRecord[] = [];
let derivedNote = "derived rows were not read: the promoted wiring could not be read here.";
try {
  const read = await readDerivedMeetingWiring({ bypassCache: true, now });
  if (read.kind === "PROMOTED") {
    derived = read.value.records;
    derivedNote = `${derived.length} derived rows read from the promoted wiring.`;
  } else derivedNote = `derived rows were not read (${read.kind}).`;
} catch {
  /* the note above already says so */
}
say(derivedNote);

const handWired = SOURCE_WIRING.flatMap((row) => {
  try {
    return doorsFromWiringRow(row);
  } catch {
    return [];
  }
});
say(`${handWired.length} hand-wired doors, ${derived.map(doorFromDerivedRecord).length} derived doors and ${feedDoorDrafts().length} non-meeting feed doors found.`);

if (!FLAGS.has("apply")) {
  const held = await listDoors(repos.doors);
  say(`dry run: the registry holds ${held.doors.length} doors now. Nothing was written. Run with --apply to import.`);
  process.exit(0);
}

const counts = await seedMeetingDoors({ repo: repos.doors, wiring: SOURCE_WIRING, derived, deriveInputAt: now, at: now });
say(`created ${counts.created}, updated ${counts.updated}, unchanged ${counts.unchanged}, kept hand edits ${counts.keptManualEdit}, refused ${counts.refused.length}.`);
for (const line of counts.refused) say(`refused: ${line}`);
const feeds = await seedFeedDoors({ repo: repos.doors, deriveInputAt: now, at: now });
say(`feeds: created ${feeds.created}, updated ${feeds.updated}, unchanged ${feeds.unchanged}, kept hand edits ${feeds.keptManualEdit}, refused ${feeds.refused.length}.`);
for (const line of feeds.refused) say(`refused: ${line}`);
const after = await listDoors(repos.doors);
say(`the registry now holds ${after.doors.length} doors.`);
process.exit(counts.refused.length + feeds.refused.length === 0 ? 0 : 2);
