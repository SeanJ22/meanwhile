import { installSavedValues } from "./keys-values.ts";
/** Staging can use an explicitly supplied loopback database fixture, never a remote credential. */
export function installLocalDatabaseFixture(connection: string | undefined): void {
  if (!connection) return;
  let host: string;
  try { host = new URL(connection).hostname; }
  catch { throw new Error("The local database fixture address is invalid."); }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("A local database fixture must run on this machine.");
  installSavedValues({ values: new Map([["DATABASE_URL", connection]]), names: new Set(["DATABASE_URL"]) });
}
