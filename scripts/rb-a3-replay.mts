import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openFactCopy, replayCopiedFacts, type FactSnapshot } from "./rb-a3-copy.mts";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/rb-a3-replay.mts <local-snapshot-directory> [report.json]");
const baseline = JSON.parse(readFileSync(new URL("../docs/measurements/rb-a3/production-counts.json", import.meta.url), "utf8")) as {
  counts: readonly { state: string; live_facts: number }[];
};
const report = [];
// Every database in this script is a fresh, in-process PostgreSQL copy. It has no remote connection.
for (const state of baseline.counts) {
  const file = join(resolve(directory), `${state.state}.json`);
  if (!existsSync(file)) {
    report.push({ state: state.state, baselineLive: state.live_facts, replayed: 0, unchanged: 0, missingCopy: true });
    continue;
  }
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as FactSnapshot;
  assert.equal(snapshot.state, state.state);
  const db = await openFactCopy(snapshot);
  try {
    const { replayed, unchanged, unavailable } = await replayCopiedFacts(db, snapshot);
    report.push({ state: state.state, baselineLive: state.live_facts, sampled: snapshot.facts?.length ?? 0, replayed, unchanged, unavailable });
  } finally { await db.pg.close(); }
}
const output = { observedAt: new Date().toISOString(), states: report };
if (process.argv[3]) writeFileSync(resolve(process.argv[3]), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
if (report.some(state => state.missingCopy || state.unavailable)) process.exitCode = 1;
