/** Route one state's entire unsorted snapshot through real intake, then check both queue implementations. No production writes. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { indexBoxFinding, type BoxFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories, memoryAggregateRepository } from "../lib/control-plane/repository/memory.ts";
import { BOX_DUE_SQL } from "../lib/control-plane/repository/pg-store.ts";
import { FINDING_SLOT_VERSIONS, slotFor, waitingForSlot } from "../lib/facts/finding-slots.ts";
const arg = (key: string) => {
  const value = process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
  assert.ok(value, `--${key}=value is required`);
  return value;
};
const now = arg("now"), tomorrow = new Date(Date.parse(now) + 86_400_000).toISOString();
type Row = [string, string, BoxFinding["fact"] | null, string | null, string | null];
const inputs: Row[] = (await readFile(arg("input"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const intake = createMemoryRepositories(), queue = createMemoryRepositories(), pg = new PGlite();
const report = { state: arg("state"), total: inputs.length, walker: 0, meetingReaders: 0, wholeRecords: 0, otherWaiting: 0,
  due: 0, dueTomorrow: 0, reasons: {} as Record<string, number>, dueFields: {} as Record<string, number> };
try {
  await pg.exec("CREATE TABLE cp_box_findings(id text PRIMARY KEY,value jsonb)");
  for (const [id, subjectId, fact, exactQuote, sourceUrl] of inputs) {
    const origin = { kind: "SCOUT" as const, resultId: id, workItemId: "pb02-replay", findingIndex: 0, artifactIds: [], recordedAt: now };
    const row = await indexBoxFinding(intake.boxFindings, { subjectId, fact: fact ?? undefined, exactQuote, sourceUrl, origin }, now);
    const expected = fact ? waitingForSlot(slotFor(fact.field, fact.value, fact.recordClass, exactQuote ?? "", sourceUrl ?? "", subjectId)) : undefined;
    assert.deepEqual(row.waitingFor, expected, `${id}: intake must persist this row's routing`);
    // Repeat the exact result against an existing, never-tried row as well as fresh intake.
    const legacy = memoryAggregateRepository<BoxFinding>("BoxFinding");
    await legacy.put(row.id, { ...row, waitingFor: undefined }, now);
    const rerouted = await indexBoxFinding(legacy, { subjectId, fact: fact ?? undefined, exactQuote, sourceUrl, origin }, now);
    assert.deepEqual(rerouted.waitingFor, expected, `${id}: an existing unsorted row must be addressed on re-report`);
    // Keep every production row's identity when measuring the legacy backlog; fresh intake can deduplicate old identities.
    await queue.boxFindings.put(id, { ...row, id, waitingFor: expected }, now);
    const reason = expected?.reason ?? "PUBLISHER";
    report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
    if (reason === "SITE_WALK_TAKES_IT") report.walker++;
    else if (reason === "SITTING_FIELDS_COME_FROM_ITS_DOOR") report.meetingReaders++;
    else if (reason === "TAKES_WHOLE_RECORDS_ONLY") report.wholeRecords++;
    else if (expected) report.otherWaiting++;
    else { report.due++; report.dueFields[fact?.field ?? "NO_FACT"] = (report.dueFields[fact?.field ?? "NO_FACT"] ?? 0) + 1; }
  }
  const rows = (await queue.boxFindings.list()).map(row => row.value);
  await pg.query("INSERT INTO cp_box_findings SELECT value->>'id',value FROM jsonb_array_elements($1::jsonb)", [JSON.stringify(rows)]);
  const today = await queue.boxFindings.due({ slots: FINDING_SLOT_VERSIONS, now, limit: inputs.length });
  assert.equal(today.length, report.due);
  for (const at of [now, tomorrow]) {
    const memory = await queue.boxFindings.due({ slots: FINDING_SLOT_VERSIONS, now: at, limit: inputs.length });
    const postgres = (await pg.query<{ id: string }>(BOX_DUE_SQL, [JSON.stringify(FINDING_SLOT_VERSIONS), at, inputs.length])).rows;
    assert.deepEqual(postgres.map(row => row.id).sort(), memory.map(row => row.id).sort());
    assert.deepEqual(memory.map(row => row.id), today.map(row => row.id));
    for (const row of memory) assert.equal(row.waitingFor, undefined, `${row.id}: intake handoff entered due`);
  }
  for (const [id, subjectId, fact, exactQuote, sourceUrl] of inputs) {
    await indexBoxFinding(intake.boxFindings, { subjectId, fact: fact ?? undefined, exactQuote, sourceUrl,
      origin: { kind: "SCOUT", resultId: `tomorrow-${id}`, workItemId: "pb02-replay", findingIndex: 0, artifactIds: [], recordedAt: tomorrow } }, tomorrow);
  }
  const freshDue = await intake.boxFindings.due({ slots: FINDING_SLOT_VERSIONS, now: tomorrow, limit: inputs.length });
  assert.ok(freshDue.every(row => row.waitingFor === undefined));
  report.dueTomorrow = today.length;
  await writeFile(arg("out"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await pg.close(); }
