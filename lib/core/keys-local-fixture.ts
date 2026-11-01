import { installSavedValues, SAVED_DATABASE_SOURCE, selectSavedDatabase } from "./keys-values.ts";
/** Staging can use an explicitly supplied loopback database fixture, never a remote credential. */
export function installLocalDatabaseFixture(connection: string | undefined): void {
  if (!connection) return;
  let host: string;
  try { host = new URL(connection).hostname; }
  catch { throw new Error("The local database fixture address is invalid."); }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("A local database fixture must run on this machine.");
  installSavedValues({ values: new Map([["DATABASE_URL", connection]]) });
}

export function installDiagnosticDatabase(connection: string | undefined): () => void {
  if (connection !== undefined) {
    const address = new URL(connection);
    if (!["postgres:", "postgresql:"].includes(address.protocol) || decodeURIComponent(address.username) !== "readonly") {
      throw new Error("A diagnostic database connection must use the read-only role.");
    }
  }
  const previousSource = process.env[SAVED_DATABASE_SOURCE];
  const previous = installSavedValues(undefined);
  const values = new Map(previous?.values);
  if (connection === undefined) values.delete("DATABASE_URL");
  else { values.set("DATABASE_URL", connection); }
  installSavedValues({ values }); selectSavedDatabase(undefined);
  return () => { installSavedValues(previous); selectSavedDatabase(previousSource); };
}
