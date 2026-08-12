/**
 * Run one source adapter locally.
 *
 *   pnpm ingest mock
 *
 * Adapters are looked up by directory name under lib/sources/. Adding a source
 * means adding a directory, never editing this file's logic — only the map
 * below gains an entry.
 */

import { mockSource } from "../lib/sources/mock/index.ts";
import type { Meeting, MeetingSource } from "../lib/sources/types.ts";

const SOURCES: Record<string, MeetingSource<never>> = {
  mock: mockSource as unknown as MeetingSource<never>,
};

async function main() {
  const name = process.argv[2];

  if (!name || !(name in SOURCES)) {
    console.error(
      `Usage: pnpm ingest <source>\nKnown sources: ${Object.keys(SOURCES).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const source = SOURCES[name];

  // Continental US, wide enough to sweep everything the adapter has.
  const raw = await source.fetch({
    lat: 39.5,
    lng: -98.35,
    radiusKm: 5000,
  });

  const meetings: Meeting[] = source.normalize(raw);
  const result = await source.upsert(meetings);

  console.log(`${source.name}: ${raw.length} fetched, ${meetings.length} normalized`);
  console.log(`  inserted ${result.inserted}, updated ${result.updated}`);

  const dropped = raw.length - meetings.length;
  if (dropped > 0) {
    console.warn(`  ${dropped} record(s) dropped — unplaceable in time or space`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
