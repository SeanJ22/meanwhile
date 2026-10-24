import assert from "node:assert/strict";
import test from "node:test";
import { factDb } from "./helpers/fact-db.ts";

test("a closed fact fixture leaves no rows, schema objects, sequences or resolver choice for the next case", async () => {
  const first = await factDb();
  await first.pg.exec("CREATE SCHEMA fixture_extra; CREATE TABLE fixture_extra.saved(value text); CREATE FUNCTION fixture_leak() RETURNS int LANGUAGE sql AS 'SELECT 1'");
  await first.query("INSERT INTO entity(id,kind,name) VALUES('same','body','Old body')");
  assert.equal(Number((await first.query("SELECT nextval('fact_id_seq') n"))[0]!.n), 1);
  await first.pg.close();
  assert.equal(first.pg.closed, true);
  await assert.rejects(first.query("SELECT 1"), /fixture is closed/);
  const next = await factDb({ withResolver: false });
  try {
    assert.deepEqual(await next.query("SELECT id FROM entity"), []);
    assert.deepEqual(await next.query("SELECT nspname FROM pg_namespace WHERE nspname='fixture_extra'"), []);
    assert.deepEqual(await next.query("SELECT to_regprocedure('fixture_leak()') leaked,to_regprocedure('reader_resolve_id(text)') resolver"), [{ leaked: null, resolver: null }]);
    assert.equal(Number((await next.query("SELECT nextval('fact_id_seq') n"))[0]!.n), 1);
  } finally { await next.pg.close(); }
});

test("simultaneously held fact fixtures remain independent databases", async () => {
  const [one, two] = await Promise.all([factDb(), factDb()]);
  try {
    await one.query("INSERT INTO entity(id,kind,name) VALUES('same','body','First body')");
    await two.query("INSERT INTO entity(id,kind,name) VALUES('same','body','Second body')");
    assert.deepEqual(await one.query("SELECT name FROM entity"), [{ name: "First body" }]);
    assert.deepEqual(await two.query("SELECT name FROM entity"), [{ name: "Second body" }]);
  } finally { await one.pg.close(); await two.pg.close(); }
});
