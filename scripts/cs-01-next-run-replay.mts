import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mock } from "node:test";
import { neon } from "@neondatabase/serverless";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonIdentity } from "../components/officials/person-identity.tsx";
import { indexByOfficeholderId } from "../lib/officials/lookup.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import { READER_CAPITAL_WORDS } from "../lib/text/reader-names.ts";

/** A read-only scheduled replay; it never invokes acquisition or advances a production clock. */
async function replay() {
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  assert.ok(connection, "WTP_PRODUCTION_DATABASE_URL_READONLY is required; never guess another database");
  const sql = neon(connection);
  const [identity] = await sql.transaction([sql`select current_user as role,
    current_setting('transaction_read_only') as read_only,
    has_table_privilege(current_user,'civic_data_promotions','INSERT,UPDATE,DELETE') as writes`], { readOnly: true });
  assert.equal(identity[0].read_only, "on");
  assert.equal(identity[0].writes, false);
  process.env.DATABASE_URL = connection;
  const store = new PostgresRoutineDataStore();
  const tasks = ROUTINE_SOURCE_TASKS.filter(task => /^openstates-people-(?!dc$|pr$)[a-z]{2}$/.test(task.id));
  assert.equal(tasks.length, 50);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const now = Date.now();
  async function checkState(task: typeof tasks[number]) {
    const state = task.id.slice(-2).toUpperCase();
    try {
      const [storedClock, promotion] = await Promise.all([
        store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion),
        store.readPromotion<OfficialStateLegislatorReadModel>(task.recordClass, task.scope),
      ]);
      assert.ok(promotion?.payload.roster.officeholders.length, `${state}: no held roster promotion`);
      const raw = JSON.stringify(promotion.payload);
      const afterToday = { lastAttemptedAt: new Date(now).toISOString(), lastSucceededAt: new Date(now).toISOString(),
        lastSucceededObservedAt: new Date(now).toISOString(), lastSucceededParserVersion: task.parserVersion };
      const nextRunMs = now + task.cadenceMs;
      assert.equal(routineTaskDue(task, afterToday, nextRunMs - 1), false);
      assert.equal(routineTaskDue(task, afterToday, nextRunMs), true);
      const renders = [now, nextRunMs].map(at => {
        // Fresh source decode and a controlled reader Date on each scheduled pass.
        const payload = JSON.parse(raw) as OfficialStateLegislatorReadModel;
        const holders = [...indexByOfficeholderId([payload.roster]).values()];
        const names = [...new Map(holders.map(holder => [holder.id, holder])).values()];
        let html: string;
        mock.timers.enable({ apis: ["Date"], now: at });
        try { html = names.map(holder => renderToStaticMarkup(createElement(PersonIdentity, { holder, seatLabel: null }))).join("\n"); }
        finally { mock.timers.reset(); }
        const visible = html.replace(/<[^>]*>/g, " ");
        const offenders = (visible.match(/(?<![\p{L}\p{N}])[\p{L}]+(?![\p{L}\p{N}])/gu) ?? [])
          .filter(word => word.length >= 3 && word === word.toUpperCase() && word !== word.toLowerCase() && !READER_CAPITAL_WORDS.has(word));
        assert.deepEqual(offenders, []);
        assert.equal(JSON.stringify(payload), raw);
        return { at: new Date(at).toISOString(), records: names.length, sourceSha256: hash(raw), renderedSha256: hash(html), offendingWords: offenders };
      });
      assert.equal(renders[0].renderedSha256, renders[1].renderedSha256);
      assert.equal(JSON.stringify(promotion.payload), raw);
      return { state, taskId: task.id, sourceId: task.sourceId, scope: task.scope, versionId: promotion.versionId,
        parserVersion: task.parserVersion, cadenceMs: task.cadenceMs, storedClock,
        storedSourceCurrentlyDue: routineTaskDue(task, storedClock, now), sourceValuesUnchanged: true, renders, errors: [] as string[] };
    } catch (error) {
      return { state, taskId: task.id, errors: [error instanceof Error ? error.message : String(error)] };
    }
  }
  const results: Awaited<ReturnType<typeof checkState>>[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < tasks.length) results.push(await checkState(tasks[next++]));
  }));
  results.sort((a, b) => a.state.localeCompare(b.state));
  const out = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? ".scratch/cs-01/next-run-replay.json");
  await mkdir(resolve(out, ".."), { recursive: true });
  const result = { checkedAt: new Date(now).toISOString(), states: results.length, readOnly: identity[0],
    replay: "Production due selector and real source bytes for every state; successful pass clocks are replayed locally only", results };
  await writeFile(out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ out, states: results.length, passed: results.filter(row => row.errors.length === 0).length,
    records: results.reduce((sum, row) => sum + (row.renders?.[0].records ?? 0), 0),
    failed: results.filter(row => row.errors.length).map(row => ({ state: row.state, errors: row.errors })) }, null, 2));
  if (results.some(row => row.errors.length)) process.exitCode = 1;
}
await replay();
