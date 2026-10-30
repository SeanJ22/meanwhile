import test from "node:test";
import assert from "node:assert/strict";
import { admittedRuntimeChildEnvironment } from "../lib/civic-data/runtime-authority.ts";
import { saveLinkingCopy } from "../lib/facts/linking-copy.ts";

// Production, Oct 25-29: every Vermont voting run failed at its first linking page with
// PERMANENT_RUNTIME_AUTHORITY_REFUSED, because the copy was saved as an unsanctioned operation on the read-only reader connection.
test("the voting job's sanctioned child saves the linking page it publishes from on its own write path", async () => {
  const parentEnv: NodeJS.ProcessEnv = { NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
    DATABASE_URL: "postgresql://local:local@127.0.0.1:9/reader", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@127.0.0.1:9/control",
    WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" };
  const child = admittedRuntimeChildEnvironment({ parentEnv, capability: "MANUAL_CONTRACT", contract: "voting-sites:VT" });
  const saved = { ...process.env };
  Object.assign(process.env, child);
  try {
    const writes: string[] = [];
    const ref = await saveLinkingCopy({ url: "https://sos.vermont.gov/elections/", html: "<a href='/towns'>Town clerks</a>" },
      "2026-10-29T12:00:00.000Z", async sql => { writes.push(sql); return []; });
    assert.equal(ref.url, "https://sos.vermont.gov/elections/");
    assert.equal(writes.length, 1);
    // Without an injected query the copy goes to the job's own database connection, under the job's promotion sanction.
    await assert.rejects(saveLinkingCopy({ url: "https://sos.vermont.gov/elections/", html: "<p>Elections</p>" }, "2026-10-29T12:00:00.000Z"),
      (error: Error) => !/RUNTIME_AUTHORITY_REFUSED|refusing to write|read-only/.test(error.message));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
