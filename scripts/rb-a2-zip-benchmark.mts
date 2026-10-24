/** Benchmark the reader alone, after the national import has completed. */
import { writeFile } from "node:fs/promises";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { placesForCode } from "../lib/place-map/read.ts";
import { placeMapCounts } from "../lib/place-map/counts.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const db = await openMapCopy("national", false);
const collections: { start: number; duration: number }[] = [];
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) collections.push({ start: entry.startTime, duration: entry.duration });
});
observer.observe({ entryTypes: ["gc"] });
try {
  const codes = await db.query("SELECT DISTINCT zip FROM zip_place ORDER BY zip");
  if (!codes.length) throw new Error("The national map copy is empty");
  const durations: number[] = [];
  const slow: { zip: string; start: number; end: number; elapsedMs: number; cpuMs: number }[] = [];
  let worstMs = 0, worstZip = "", memberships = 0;
  for (const row of codes) {
    const zip = String(row.zip), cpuStart = process.cpuUsage(), start = performance.now();
    const result = await placesForCode(db.query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
    const elapsed = performance.now() - start;
    if (elapsed >= 20) {
      const cpu = process.cpuUsage(cpuStart);
      slow.push({ zip, start, end: start + elapsed, elapsedMs: elapsed, cpuMs: (cpu.user + cpu.system) / 1000 });
    }
    if (!result.memberships.length) throw new Error(`ZIP ${zip} has no readable memberships`);
    durations.push(elapsed);
    if (elapsed > worstMs) { worstMs = elapsed; worstZip = zip; memberships = result.memberships.length; }
  }
  durations.sort((a, b) => a - b);
  const adminStart = performance.now(), adminCounts = await placeMapCounts(db.query);
  const adminElapsed = performance.now() - adminStart;
  for (const entry of observer.takeRecords()) collections.push({ start: entry.startTime, duration: entry.duration });
  const round = (value: number) => Math.round(value * 100) / 100;
  const result = { engine: "PostgreSQL 17.11", states: 56, zips: codes.length, worstZip, memberships,
    worstZipMs: round(worstMs), medianMs: round(durations[Math.floor(durations.length * 0.5)]),
    p99Ms: round(durations[Math.floor(durations.length * 0.99)]), adminCountsMs: round(adminElapsed),
    adminJurisdictions: adminCounts.length,
    slowLookups: slow.map(row => ({ zip: row.zip, elapsedMs: round(row.elapsedMs), cpuMs: round(row.cpuMs),
      overlappingGcMs: round(collections.filter(gc => gc.start < row.end && gc.start + gc.duration > row.start).reduce((sum, gc) => sum + gc.duration, 0)) })),
    passed: worstMs < 50 && adminElapsed < 3000 && adminCounts.length === 56 };
  await writeFile("/tmp/rb-a2-replay/national-benchmark.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally { observer.disconnect(); await db.close(); }
