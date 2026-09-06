import { drizzle } from "drizzle-orm/neon-http";
import { createGuardedNeon } from "./guarded-neon.ts";

// Extension explicit so the file also loads under `node --test`'s
// strip-types resolver, which the search-log tests run through.
import * as schema from "./schema.ts";

/*
  Lazy on purpose. Nothing in the map entry screen reads Postgres, so a missing
  DATABASE_URL must not break `pnpm dev`. The first caller that actually needs a
  connection is the one that gets the error.
*/
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(operation?: string) {
  if (cached && !operation) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }

  const db = drizzle(createGuardedNeon(url, { operation }), { schema });
  if (!operation) cached = db;
  return db;
}
