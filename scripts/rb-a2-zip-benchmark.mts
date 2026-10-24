/** Benchmark the reader alone, after the national import has completed. */
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { placesForCode } from "../lib/place-map/read.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const db = await openMapCopy("national", false);
try {
  const codes = await db.query("SELECT DISTINCT zip FROM zip_place ORDER BY zip");
  if (!codes.length) throw new Error("The national map copy is empty");
  const durations: number[] = [];
  let worstMs = 0, worstZip = "", memberships = 0;
  for (const row of codes) {
    const zip = String(row.zip), start = performance.now();
    const result = await placesForCode(db.query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
    const elapsed = performance.now() - start;
    if (!result.memberships.length) throw new Error(`ZIP ${zip} has no readable memberships`);
    durations.push(elapsed);
    if (elapsed > worstMs) { worstMs = elapsed; worstZip = zip; memberships = result.memberships.length; }
  }
  durations.sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 100) / 100;
  const result = { engine: "PostgreSQL 17.11", states: 56, zips: codes.length, worstZip, memberships,
    worstZipMs: round(worstMs), medianMs: round(durations[Math.floor(durations.length * 0.5)]),
    p99Ms: round(durations[Math.floor(durations.length * 0.99)]), passed: worstMs < 50 };
  await writeFile("/tmp/rb-a2-replay/national-benchmark.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally { await db.close(); }
