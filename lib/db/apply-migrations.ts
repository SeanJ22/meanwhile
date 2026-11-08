import { readFileSync } from "node:fs";

/** Applies every committed migration, in the journal's order, to a fresh in-process database. */
export async function applyMigrations(pg: { exec(sql: string): Promise<unknown> }): Promise<void> {
  const directory = new URL("./migrations/", import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) await pg.exec(readFileSync(new URL(`${tag}.sql`, directory), "utf8"));
}
