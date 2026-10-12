import assert from "node:assert/strict";
import test from "node:test";
import { neonConfig } from "@neondatabase/serverless";

import { feedbackConnection, readFeedback, writeFeedback } from "../lib/db/feedback.ts";
import { flushDatabaseTransfer } from "../lib/db/transfer.ts";

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
