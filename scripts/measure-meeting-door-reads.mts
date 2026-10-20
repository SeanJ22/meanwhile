import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { neon, neonConfig } from "@neondatabase/serverless";
import { changedMeetingDoors } from "../lib/doors/changed-meeting-doors.ts";

const connection = readFileSync("/tmp/mp01-cp-readonly-url", "utf8").trim();
if (new URL(connection).username !== "wtp_cp_release_readonly") throw new Error("Door measurements require the production read-only role");
let responseBytes = 0, requests = 0;
neonConfig.fetchFunction = async (url: RequestInfo | URL, init?: RequestInit) => {
  const response = await fetch(url, init);
  responseBytes += (await response.clone().arrayBuffer()).byteLength;
  requests++;
  return response;
};
const sql = neon(connection);
const query = (text: string, parameters: readonly unknown[]) => sql.query(text, [...parameters]);
const baseline = await query(`SELECT count(*)::int AS rows, sum(octet_length(value::text))::bigint AS value_bytes,
  count(*) FILTER (WHERE value->'meeting' IS NOT NULL AND value->'meeting'<>'null'::jsonb)::int AS meeting_rows
  FROM cp_doors`, []);
const heartbeat = await query(`SELECT beat.value->>'beatAt' AS at, hour->>'hour' AS hour,
  item->>'caller' AS caller,item->>'bytes' AS bytes FROM cp_runner_heartbeat beat,
  LATERAL (VALUES (beat.value #> '{neonBytes,lastFullHour}'), (beat.value #> '{neonBytes,currentHour}')) h(hour),
  LATERAL jsonb_array_elements(coalesce(hour->'byCaller','[]'::jsonb)) item
  WHERE id='pilot-runner' AND (item->>'caller' ILIKE '%platform-census%' OR item->>'caller' ILIKE '%publish-meeting-doors%')`, []);
const root = mkdtempSync(join(tmpdir(), "mp01-production-door-copy-"));
const run = async (state?: string) => {
  const before = responseBytes, count = requests, start = performance.now();
  const rows = await changedMeetingDoors({ connection, root, query, state });
  return { rows: rows.length, bytes: responseBytes - before, requests: requests - count, ms: performance.now() - start };
};
const publisherCold = await run(), publisherWarm = await run();
const report = { observedAt: new Date().toISOString(), baseline, heartbeat, publisherCold, publisherWarm,
  totalProductionResponseBytes: responseBytes, requests,
  expectedHourlyNoChanges: { publisherAt12Runs: publisherWarm.bytes * 12, censusBulkDoorReads: 0 },
  limitations: "Response body bytes include Neon JSON framing. Hourly projections assume no changed doors and the five-minute standing admission interval; active changes add their own rows. The baseline aggregate reads sizes on the server and returns no unrelated door values." };
writeFileSync("/tmp/mp01-door-read-measure.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
