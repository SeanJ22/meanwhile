import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Extension explicit so the file also loads under `node --test`'s
// strip-types resolver, which the search-log tests run through.
import * as schema from "./schema.ts";
import { installDatabaseTransferCounter } from "./transfer.ts";

/*
  Lazy on purpose. Nothing in the map entry screen reads Postgres, so a missing
  DATABASE_URL must not break `pnpm dev`. The first caller that actually needs a
  connection is the one that gets the error.
*/
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  installDatabaseTransferCounter();
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }

  cached = drizzle(neon(url), { schema });
  return cached;
}
