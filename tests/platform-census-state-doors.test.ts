import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { censusDivisionPrefix } from "../lib/control-plane/discovery/census-lane.ts";

/** The runner runs on import (connections, a singleton lock), so its query is read from its source, not imported. */
const SOURCE = readFileSync(join(import.meta.dirname, "..", "scripts", "platform-census-runner.mts"), "utf8");

function stateDoorsQuery(): string {
  const start = SOURCE.indexOf("`SELECT d.id FROM cp_doors d WHERE");
  assert.ok(start >= 0, "the runner selects a state's doors from cp_doors");
  return SOURCE.slice(start + 1, SOURCE.indexOf("`", start + 1));
}

test("the census runner casts the extracted jsonb before it is matched with LIKE", () => {
  const query = stateDoorsQuery();
  assert.ok(query.includes("(d.value->'bodyIds')::text LIKE $2"), "the array is cast as a whole");
  assert.doesNotMatch(SOURCE, /->\s*'bodyIds'::text/, "the cast must never bind to the key literal, which leaves a jsonb value under LIKE");
});

async function database(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE cp_doors (id text PRIMARY KEY, value jsonb NOT NULL);
    CREATE TABLE cp_work_items (id text PRIMARY KEY, value jsonb NOT NULL);`);
  const doors: [string, object][] = [
    ["by-ocd", { ocdId: "ocd-division/country:us/state:az/county:pima", bodyIds: [] }],
    ["by-body", { ocdId: "ocd-division/country:us/state:fl/place:x", bodyIds: ["ocd-division/country:us/state:az/place:mesa#governing"] }],
    ["by-plan", { ocdId: "ocd-division/country:us/state:fl/place:y", bodyIds: [] }],
    ["elsewhere", { ocdId: "ocd-division/country:us/state:fl/place:z", bodyIds: ["ocd-division/country:us/state:fl/place:z#governing"] }],
  ];
  for (const [id, value] of doors) await pg.query("INSERT INTO cp_doors VALUES ($1, $2::jsonb)", [id, JSON.stringify(value)]);
  await pg.query("INSERT INTO cp_work_items VALUES ('w1', $1::jsonb)", [JSON.stringify({ publicationOutcome: { doorId: "by-plan" }, autonomousPlan: { jurisdiction: "az" } })]);
  return pg;
}

test("the census runner's state-doors query runs on Postgres and finds a state's doors by place, body and plan", async () => {
  const pg = await database();
  try {
    const prefix = censusDivisionPrefix("az");
    const rows = await pg.query<{ id: string }>(stateDoorsQuery(), [`${prefix}%`, `%/${prefix.split("/").at(-1)}%`, "AZ"]);
    assert.deepEqual(rows.rows.map((row) => row.id).sort(), ["by-body", "by-ocd", "by-plan"]);
  } finally {
    await pg.close();
  }
});

test("without the cast Postgres refuses the query, which is why the census runner failed", async () => {
  const pg = await database();
  try {
    const broken = stateDoorsQuery().replace("(d.value->'bodyIds')::text", "d.value->'bodyIds'::text");
    assert.notEqual(broken, stateDoorsQuery());
    await assert.rejects(pg.query(broken, ["%", "%", "AZ"]), (error: { code?: string }) => error.code === "42883");
  } finally {
    await pg.close();
  }
});
