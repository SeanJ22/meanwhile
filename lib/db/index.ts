import { storedKeyValue } from "../core/keys-values.ts";
import { neon } from "./client.ts";
import { drizzle } from "drizzle-orm/neon-http";

// Explicit extension so the file also loads under node --test strip-types.
import * as schema from "./schema.ts";
import { installDatabaseTransferCounter } from "./transfer.ts";
import { installConnectAttemptWindow } from "../ops/connect-attempt-window.ts";

// Lazy, so a missing DATABASE_URL only fails the first caller that needs a connection.
let cachedConnection: string | undefined;
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  installDatabaseTransferCounter();
  installConnectAttemptWindow();

  const url = storedKeyValue("DATABASE_URL");
  if (cached && cachedConnection === url) return cached;
  if (!url) {
    throw new Error(
      "The saved database connection is unavailable. Check the Keys box in Admin Settings.",
    );
  }

  cachedConnection = url;
  cached = drizzle(neon(url), { schema });
  return cached;
}
