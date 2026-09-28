import { defineConfig } from "drizzle-kit";

/*
  No tables yet. The map entry screen serves mocks through a source adapter and
  never touches Postgres. This config exists so the first real schema change is
  a `pnpm db:generate` away rather than a setup task.
*/
export default defineConfig({
  dialect: "postgresql",
  schema: ["./lib/db/schema.ts", "./lib/db/admin-publication-search-schema.ts"],
  out: "./lib/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
