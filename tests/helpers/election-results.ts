import type { TestContext } from "node:test";
import { CivicReadCache } from "../../lib/db/civic-read-cache.ts";
import { createElectionResultFeedStore } from "../../lib/election-results/feed-store.ts";
import { WORK_DDL, workList } from "../../lib/core/work.ts";
import { markSlicesOn } from "../../lib/core/slice-marks.ts";
import { factDb } from "./fact-db.ts";
import { migratedFactDb } from "./migrated-reader-db.ts";

export function resultReadCache(): CivicReadCache {
  const values = new Map<string, string>();
  return new CivicReadCache({ read: async key => values.get(key) ?? null,
    write: async (key, value) => { values.set(key, value); } });
}

export function resultFeedMemory() {
  const values = new Map<string, unknown>();
  return createElectionResultFeedStore({ read: async key => values.get(key) ?? null,
    write: async (key, value) => { values.set(key, structuredClone(value)); } });
}

/** The real fact store and work schema used by source, cadence, and Slide tests. */
export async function resultFactDb(context: TestContext, owner: string, places: Readonly<Record<string, string>> = {}) {
  const db = await factDb();
  context.after(() => db.pg.close());
  for (const statement of WORK_DDL) await db.pg.exec(statement);
  await db.pg.exec("CREATE TABLE civic_data_promotions(scope text,record_class text,current_version_id text)");
  markSlicesOn(() => workList(db.query, { owner }));
  for (const [state, name] of Object.entries({ US: "United States", ...places })) {
    const id = `ocd-division/country:us${state === "US" ? "" : `/state:${state.toLowerCase()}`}`;
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$2,$3)", [id, name, state === "US" ? null : state]);
  }
  return db;
}

export async function resultBallotDb(context: TestContext) {
  const db = await migratedFactDb();
  context.after(() => db.pg.close());
  return db;
}
