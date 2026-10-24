import assert from "node:assert/strict";
import test from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { POST } from "../app/api/speak/route.ts";

test("a failed Speak your mind save returns 500 and raises exactly one alarm; stored returns 204", async () => {
  const names = ["DATABASE_URL", "WTP_DB_ROLE", "WTP_RIPCORD_RATE_LIMITS", "WTP_RIPCORD_REACTION_INTAKE"];
  const prior = names.map(name => [name, process.env[name]] as const);
  const priorFetch = neonConfig.fetchFunction;
  Object.assign(process.env, { DATABASE_URL: "postgresql://local:local@localhost/speak-test", WTP_DB_ROLE: "local",
    WTP_RIPCORD_RATE_LIMITS: "pulled", WTP_RIPCORD_REACTION_INTAKE: "live" });
  let fails = true, alarms = 0, saves = 0;
  neonConfig.fetchFunction = async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { query: string };
    if (request.query.includes('insert into "speak_your_mind"')) {
      saves++;
      if (fails) throw new Error("forced save failure");
    } else if (request.query.includes('insert into "write_alarm"')) alarms++;
    return Response.json({ command: "INSERT", rowCount: 1, rowAsArray: true, fields: [], rows: [] });
  };
  const request = () => new Request("http://localhost/api/speak", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ subjectType: "OFFICIAL", subjectId: "official:test", text: "Please explain this vote.", speakKey: "a".repeat(32) }) });
  try {
    const failed = await POST(request());
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "could not record that" });
    assert.equal(alarms, 1);
    fails = false;
    const stored = await POST(request());
    assert.equal(stored.status, 204);
    assert.equal(await stored.text(), "");
    assert.equal(saves, 2);
    assert.equal(alarms, 1);
  } finally {
    neonConfig.fetchFunction = priorFetch;
    for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
