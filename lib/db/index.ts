import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Explicit extension so the file also loads under node --test strip-types.
import * as schema from "./schema.ts";
import { installDatabaseTransferCounter } from "./transfer.ts";
import { installConnectAttemptWindow } from "../ops/connect-attempt-window.ts";

// Lazy, so a missing DATABASE_URL only fails the first caller that needs a connection.
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  installDatabaseTransferCounter();
  if (cached) return cached;
  installConnectAttemptWindow();

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }

  cached = drizzle(neon(url), { schema });
  return cached;
}
