import assert from "node:assert/strict";
import test from "node:test";
import { neonConfig } from "@neondatabase/serverless";

import { feedbackConnection, readFeedback, writeFeedback } from "../lib/db/feedback.ts";
import { flushDatabaseTransfer } from "../lib/db/transfer.ts";
import { carryOverFeedback } from "../lib/db/feedback-carryover.ts";

const old = "postgresql://local:local@ep-old-feedback.us-east-2.aws.neon.tech/neondb";
const dedicated = "postgresql://local:local@ep-dedicated-feedback.us-east-2.aws.neon.tech/neondb";
interface Sent { connection: string; query: string; params: unknown[] }

async function mocked(run: (sent: Sent[]) => Promise<void>, answer: (sent: Sent) => Record<string, unknown>[] = () => []) {
  const saved = { fetch: neonConfig.fetchFunction, env: { ...process.env } };
  const sent: Sent[] = [];
  neonConfig.fetchFunction = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const statements = body.queries ?? [body];
    const results = statements.map((statement: { query: string; params: unknown[] }) => {
      const request = { connection: new Headers(init?.headers).get("neon-connection-string")!, ...statement };
      sent.push(request);
      const rows = answer(request);
      const names = rows.length ? Object.keys(rows[0]) : [];
      return { command: "SELECT", rowCount: rows.length, rowAsArray: true,
        fields: names.map(name => ({ name, dataTypeID: 25 })),
        rows: rows.map(row => names.map(name => row[name] === null ? null : String(row[name]))) };
    });
    return new Response(JSON.stringify(body.queries ? { results } : results[0]), { status: 200 });
  };
  Object.assign(process.env, { DATABASE_URL: old, FEEDBACK_DATABASE_URL: dedicated, WTP_DB_ROLE: "local", WTP_SITE: "tester" });
  try { await run(sent); }
  finally {
    await flushDatabaseTransfer();
    neonConfig.fetchFunction = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
}

test("feedback writes and reads use the dedicated branch and preserve the originating site", async () => {
  await mocked(async sent => {
    assert.deepEqual(await writeFeedback({ message: "The published meeting date looks wrong", surface: "COVERAGE", about: "Meeting", zip: "85635", recordId: "cochise-supervisors" }), { kind: "STORED" });
    await readFeedback({ since: "2026-09-01", site: "tester" });
    const insert = sent.find(row => /insert into "feedback"/.test(row.query))!;
    const read = sent.find(row => /from "feedback"/.test(row.query))!;
    assert.equal(insert.connection, dedicated);
    assert.ok(insert.params.includes("tester"));
    for (const value of ["Meeting", "85635", "cochise-supervisors"]) assert.ok(insert.params.includes(value));
    for (const column of ["about", "zip", "record_id"]) assert.ok(read.query.includes(`"${column}"`));
    assert.equal(read.connection, dedicated);
    assert.ok(read.query.includes('"site" ='));
    assert.ok(read.params.includes("tester"));
    delete process.env.FEEDBACK_DATABASE_URL;
    process.env.WTP_SITE = "live";
    await writeFeedback({ message: "The map has no meeting link", surface: "SIDEBAR" });
    const fallback = sent.filter(row => /insert into "feedback"/.test(row.query)).at(-1)!;
    assert.equal(fallback.connection, old);
    assert.ok(fallback.params.includes("live"));
  });
  assert.equal(feedbackConnection({}), null);
});

test("carry-over reads the old store without writing it, preserves report/contact IDs, and never overwrites a report", async () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000001", received_at: "2026-09-29T15:00:00Z",
    message: "The published time is wrong", surface: "SIDEBAR", contact_ref: "original-contact",
    run_class: "ORGANIC", run_id: null, suspect_reason: null, site: "live",
    about: null, zip: null, record_id: null, reply_address: "reply@example.org",
    contact_received_at: "2026-09-29T15:00:00Z",
  };
  let present = false;
  await mocked(async sent => {
    const plan = await carryOverFeedback(old, dedicated, false);
    assert.equal(plan.kind, "PLAN");
    assert.equal(plan.reports, 1);
    assert.ok(sent.every(s => !/INSERT|UPDATE|DELETE/i.test(s.query)));
    assert.equal((await carryOverFeedback(old, dedicated, true)).copied, 1);
    assert.equal((await carryOverFeedback(old, dedicated, true)).copied, 0);
    assert.ok(sent.filter(s => s.connection === old).every(s => !/INSERT|UPDATE|DELETE/i.test(s.query)));
    const contact = sent.find(s => /INSERT INTO feedback_contact/.test(s.query))!;
    const report = sent.find(s => /INSERT INTO feedback \(/.test(s.query))!;
    assert.equal(contact.connection, dedicated);
    assert.deepEqual(contact.params, [row.contact_ref, row.reply_address, row.contact_received_at]);
    assert.equal(report.params[0], row.id);
    assert.deepEqual(report.params.slice(-3), [null, null, null]);
    assert.match(report.query, /ON CONFLICT \(id\) DO NOTHING/);
  }, request => {
    if (/count\(\*\)/.test(request.query)) return [{ count: "1", through: row.received_at }];
    if (/FROM feedback f/.test(request.query)) return request.params[1] ? [] : [row];
    if (/INSERT INTO feedback \(/.test(request.query)) {
      if (present) return [];
      present = true;
      return [{ id: row.id }];
    }
    return [];
  });
});
