import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { emptyPicks, parsePicksFile, applyPickChanges } from "../lib/ballot/picks-file.ts";
import { savedPicksStore, privatePicksDigest } from "../lib/db/saved-picks.ts";
import { handleSavedPicks } from "../lib/ballot/saved-picks-handler.ts";

const secret = () => randomBytes(32).toString("base64url");
const picked = () => ({ ...emptyPicks(), picks: { race: { contestId: "race", contestTitle: "Mayor", choiceIds: ["candidate-a"], labels: { "candidate-a": "A" } } } });

test("private storage requires the capability, isolates lists and atomically refuses stale updates", async () => {
  const priorRole = process.env.WTP_DB_ROLE;
  process.env.WTP_DB_ROLE = "local";
  const db = new PGlite();
  try {
    await db.exec(readFileSync("lib/db/migrations/PK-01_saved_picks.sql", "utf8"));
    const store = savedPicksStore(async (text, params) => (await db.query(text, [...params])).rows as Record<string, unknown>[]);
    const key = secret();
    const call = (method: string, code = key, body?: unknown, origin = "http://ballot.test") => handleSavedPicks(new Request("http://ballot.test/api/ballot/picks", {
      method, headers: { authorization: `Bearer ${code}`, origin }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), store);
    assert.equal((await call("GET", "")).status, 401);
    assert.equal((await call("GET", secret())).status, 404);
    assert.equal((await call("PUT", key, { file: picked() }, "http://elsewhere.test")).status, 403);
    const created = await call("PUT", key, { file: { ...picked(), email: "discard@example.test", phone: "5555555555" }, name: "discard" });
    assert.equal(created.status, 201);
    assert.match(created.headers.get("cache-control")!, /no-store/);
    assert.equal((await call("PUT", key, { file: emptyPicks() })).status, 409);
    const updated = { ...emptyPicks(), unsure: { race: true as const } };
    const results = await Promise.all([call("PATCH", key, { revision: 0, file: updated }), call("PATCH", key, { revision: 0, file: picked() })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const saved = await (await call("GET")).json();
    assert.equal(saved.revision, 1);
    const other = secret();
    assert.equal((await call("PUT", other, { file: emptyPicks() })).status, 201);
    assert.deepEqual((await (await call("GET", other)).json()).file.picks, {});
    const rows = await db.query<Record<string, unknown>>("SELECT * FROM saved_ballot_picks");
    assert.ok(rows.rows.some(row => row.secret_hash === privatePicksDigest(key)));
    const serialized = JSON.stringify(rows.rows);
    for (const privateValue of [key, other, "discard@example.test", "5555555555", '"name"']) assert.ok(!serialized.includes(privateValue));
    assert.deepEqual(Object.keys(rows.rows[0]!).sort(), ["file", "revision", "secret_hash"]);
  } finally {
    await db.close();
    if (priorRole === undefined) delete process.env.WTP_DB_ROLE; else process.env.WTP_DB_ROLE = priorRole;
  }
});

test("the wire shape rejects malformed picks and merges clears without discarding unrelated races", () => {
  assert.equal(parsePicksFile({ ...picked(), picks: { race: { ...picked().picks.race, choiceIds: ["candidate-a", "candidate-a"] } } }), null);
  assert.equal(parsePicksFile(JSON.parse('{"version":2,"picks":{},"suppressedDerived":{"__proto__":[]}}')), null);
  const base = { ...picked(), unsure: { other: true as const } };
  const merged = applyPickChanges(base, emptyPicks(), ["race"]);
  assert.deepEqual(merged.picks, {});
  assert.deepEqual(merged.unsure, { other: true });
});
