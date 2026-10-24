import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { door } from "../lib/core/door.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { FieldKind, Provenance } from "../lib/facts/check.ts";
import { openFactCopy, type FactSnapshot } from "./rb-a3-copy.mts";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/rb-a3-replay.mts <local-snapshot-directory> [report.json]");
const baseline = JSON.parse(readFileSync(new URL("../docs/measurements/rb-a3/production-counts.json", import.meta.url), "utf8")) as {
  counts: readonly { state: string; live_facts: number }[];
};
const report = [];
const kindOf = (field: string): FieldKind => /^member:|^name$|^office:/.test(field) ? "officeholder"
  : /money|contribution|expenditure|receipt|funding/.test(field) ? "money"
  : /agenda/.test(field) ? "agenda" : /meeting|sitting/.test(field) ? "meeting" : /vote/.test(field) ? "vote"
  : /portrait|photo/.test(field) ? "portrait" : /statement/.test(field) ? "statement" : /comment:/.test(field) ? "comment_rule" : "contact";

// Every database in this script is a fresh, in-process PostgreSQL copy. It has no remote connection.
for (const state of baseline.counts) {
  const file = join(resolve(directory), `${state.state}.json`);
  if (!existsSync(file)) {
    report.push({ state: state.state, available: state.live_facts, replayed: 0, unchanged: 0, missingCopy: true });
    continue;
  }
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as FactSnapshot;
  assert.equal(snapshot.state, state.state);
  const db = await openFactCopy(snapshot);
  try {
    const facts = snapshot.facts ?? [], copies = snapshot.sourceCopies ?? [];
    const sources = new Map(copies.map(copy => [Number(copy.id), copy]));
    let unchanged = 0, unavailable = 0;
    for (const fact of facts) {
      const copy = sources.get(Number(fact.source_copy_id));
      if (!copy) { unavailable++; continue; }
      const claim = { subjectId: String(fact.entity_id), field: String(fact.field), fieldKind: kindOf(String(fact.field)),
        value: fact.value, valueText: String(fact.value_text), quote: String(fact.quote), provenance: fact.provenance_kind as Provenance,
        producedBy: String(fact.produced_by), costUsd: Number(fact.cost_usd),
        copy: { id: Number(copy.id), finalUrl: String(copy.final_url), text: snapshot.texts?.[String(copy.id)] ?? "",
          fetchedAt: new Date(String(copy.fetched_at)), isArchive: copy.is_archive === true } };
      const second = sources.get(Number(fact.second_copy_id));
      const input = second ? { ...claim, second: { copy: { id: Number(second.id), finalUrl: String(second.final_url),
        text: snapshot.texts?.[String(second.id)] ?? "", fetchedAt: new Date(String(second.fetched_at)), isArchive: second.is_archive === true }, quote: String(fact.quote) } } : claim;
      const outcome = await door(db, input, factClocks(null), new Date(snapshot.capturedAt), { purge: async () => ({ purged: true }) });
      assert.ok("decision" in outcome && outcome.decision === "CONFIRM", `${state.state} fact ${fact.id}: ${JSON.stringify(outcome)}`);
      const [after] = await db.query("SELECT id,value FROM fact WHERE entity_id=$1 AND field=$2 AND status='live'", [fact.entity_id, fact.field]);
      assert.equal(Number(after!.id), Number(fact.id));
      assert.deepEqual(after!.value, fact.value);
      unchanged++;
    }
    report.push({ state: state.state, available: state.live_facts, sampled: facts.length, replayed: unchanged, unchanged, unavailable });
  } finally { await db.pg.close(); }
}
const output = { observedAt: new Date().toISOString(), states: report };
if (process.argv[3]) writeFileSync(resolve(process.argv[3]), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
if (report.some(state => state.replayed < 1_000)) process.exitCode = 1;
