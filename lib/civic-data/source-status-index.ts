import { readFileSync, readdirSync } from "node:fs";

// River numbers the migration. The SQL remains the single schema definition.
const directory = new URL("../db/migrations/", import.meta.url);
const marker = "-- CP-01 current publication status.";
const filename = readdirSync(directory).find(name => name.endsWith(".sql") && readFileSync(new URL(name, directory), "utf8").startsWith(marker));
if (!filename) throw new Error("The publication status migration is missing");
const [schema, backfill] = readFileSync(new URL(filename, directory), "utf8").split("-- CP-01 source status backfill begins.");
export const SOURCE_STATUS_DDL = schema.split("--> statement-breakpoint").map(statement => statement.trim()).filter(Boolean);
export const SOURCE_STATUS_BACKFILL_DDL = backfill.trim();
