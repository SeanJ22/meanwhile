import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { RunnerFamilyReads } from "../app/(admin)/_mw/admin-v6/screen-money.tsx";
import { runnerReadFamilies, runnerReadFamily, runnerReadProblems } from "../lib/db/runner-read-families.ts";
import { runnerDatabaseTransferView } from "../lib/db/transfer.ts";
import { readRunnerReadProblems } from "../lib/control-plane/line-keeper/read.ts";
import { withKeeperFixes } from "../lib/control-plane/line-keeper/keep.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { countNeonBytes, processNeonBytes, withQueryCaller } from "../lib/db/transfer-by-caller.ts";

test("the runner reads view sums state jobs and both databases into one family without losing job or file detail", () => {
  const hour = "2026-10-25T23:00:00.000Z";
  const view = runnerDatabaseTransferView([
    { hour, database: "reader", requests: 2, requestBytes: 20, responseBytes: 300_000_000,
      reads: { "voting-sites:AZ\tcivic_data_promotions\tlib/ballot/voting-source-publication.ts": [1, 10, 100_000_000],
        "voting-sites:NY\tcivic_data_payload_parts\tlib/ballot/voting-source-publication.ts": [1, 10, 200_000_000] } },
    { hour, database: "control-plane", requests: 1, requestBytes: 10, responseBytes: 50_000_000,
      reads: { "voting-sites:AZ\tcp_doors\tlib/doors/runner-reads.ts": [1, 10, 50_000_000] } },
  ]);
  const [family] = runnerReadFamilies(view.reads);
  assert.equal(family.family, "voting-sites");
  assert.equal(family.readerBytes, 300_000_000);
  assert.equal(family.controlPlaneBytes, 50_000_000);
  assert.deepEqual(family.jobs, ["voting-sites:AZ", "voting-sites:NY"]);
  assert.deepEqual(family.files, ["lib/ballot/voting-source-publication.ts", "lib/doors/runner-reads.ts"]);
  const markup = renderToStaticMarkup(createElement(RunnerFamilyReads, { rows: view.reads }));
  for (const expected of ["Job families · GB per hour", "Reader database", "Control plane", "0.30 GB", "0.05 GB", "0.35 GB", ...family.files])
    assert.ok(markup.includes(expected), expected);
  assert.equal(runnerReadFamily("openstates-people-az"), "openstates-people");
  assert.equal(runnerReadFamily("ny-state-people"), "state-people");
  assert.equal(runnerReadFamily("unfamiliar-job"), "unfamiliar-job");
});

test("hourly read accounting saves the caller file beside the job and table", () => {
  const previous = process.env.WTP_DATABASE_JOB;
  process.env.WTP_DATABASE_JOB = "file-attribution:AZ";
  try {
    withQueryCaller("cp_doors.list", () => countNeonBytes("control-plane", 123, Date.parse("2026-10-25T22:30:00Z"), { requests: 1, bytes: 12 }));
    const read = processNeonBytes().find(row => row.hour === "2026-10-25T22:00:00.000Z")!;
    const [key, bytes] = Object.entries(read.reads!).find(([key]) => key.startsWith("control-plane\tfile-attribution:AZ\t"))!;
    assert.equal(key, "control-plane\tfile-attribution:AZ\tcp_doors\ttests/runner-read-families.test.tsx");
    assert.deepEqual(bytes, [1, 12, 123]);
  } finally {
    if (previous === undefined) delete process.env.WTP_DATABASE_JOB; else process.env.WTP_DATABASE_JOB = previous;
  }
});

test("the line keeper compares the last full hour with 24 prior hours, including quiet hours, and creates owned brief work", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,reads jsonb)");
    const from = "2026-10-25T23:00:00.000Z", through = "2026-10-26T00:00:00.000Z";
    // One busy baseline hour, 23 quiet ones: average is 0.01 GB/hour across both databases.
    for (let offset = 1; offset <= 24; offset++) {
      await pg.query("INSERT INTO database_transfer_hourly VALUES($1::timestamptz,'reader',$2::jsonb)", [
        new Date(Date.parse(from) - offset * 3_600_000).toISOString(),
        JSON.stringify(offset === 1 ? { "voting-sites:NY\tcivic_data_promotions": [1, 0, 240_000_000] } : {}),
      ]);
    }
    for (const [database, bytes, table, file] of [
      ["reader", 12_000_000, "civic_data_promotions", "lib/ballot/voting-source-publication.ts"],
      ["control-plane", 8_000_000, "cp_doors", "lib/doors/runner-reads.ts"],
    ] as const) {
      await pg.query("INSERT INTO database_transfer_hourly VALUES($1::timestamptz,$2,$3::jsonb)", [from, database,
        JSON.stringify({ [`voting-sites:AZ\t${table}\t${file}`]: [1, 0, bytes] })]);
    }
    // A live partial hour must not enter the comparison.
    await pg.query("INSERT INTO database_transfer_hourly VALUES($1::timestamptz,'reader',$2::jsonb)", [through,
      JSON.stringify({ "other-job\tignored": [1, 0, 1e9] })]);
    const problems = await readRunnerReadProblems({ query: async (text, params = []) => (await pg.query(text, [...params])).rows }, from, through);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].owner, "the database workers");
    assert.match(problems[0].says, /0\.020 GB.*reader 0\.012 GB; control plane 0\.008 GB.*0\.010 GB\/hour/);
    for (const detail of ["voting-sites:AZ", "lib/ballot/voting-source-publication.ts", "lib/doors/runner-reads.ts", "civic_data_promotions", "cp_doors"])
      assert.ok(problems[0].says.includes(detail), detail);
    const hour = { from, through, measuredAt: through, problems, counts: [], waiting: [], own: { bytesRead: 0 } };
    const initial = defaultAdminConfig(through), config = withKeeperFixes(initial, hour);
    assert.deepEqual(config.settings, initial.settings);
    assert.equal(config.fixList!.length, 1);
    assert.equal(config.latestBrief!.problems.length, 1);
    assert.match(config.latestBrief!.problems[0].next, /voting-sites:AZ.*lib\/ballot/);
    assert.equal(withKeeperFixes(config, hour).fixList!.length, 1, "the next report updates the same repair");
    await pg.exec("DELETE FROM database_transfer_hourly WHERE hour=(SELECT min(hour) FROM database_transfer_hourly)");
    assert.equal((await readRunnerReadProblems({ query: async (text, params = []) => (await pg.query(text, [...params])).rows }, from, through)).length, 0,
      "partial accounting coverage does not invent a 24-hour baseline");
  } finally { await pg.close(); }
});

test("a family below twice its average creates no fix; new activity over a fully recorded quiet baseline does", () => {
  const row = { database: "reader", job: "new-job", responseBytes: 19, previousBytes: 240, previousHours: 24, files: ["scripts/new-job.mts"], tables: ["civic_data_promotions"] };
  assert.deepEqual(runnerReadProblems([row]), []);
  assert.equal(runnerReadProblems([{ ...row, previousBytes: 0 }]).length, 1);
  assert.deepEqual(runnerReadProblems([{ ...row, previousBytes: 0, responseBytes: 0 }]), []);
});
