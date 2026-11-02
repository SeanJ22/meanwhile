import { storedKeyValue } from "./lib/core/keys-values.ts";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dbCredentials: {
    url: storedKeyValue("DATABASE_URL")!,
  },
  strict: true,
  verbose: true,
});
