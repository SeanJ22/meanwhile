/** Preview code never opens a remote database. Local fixtures remain available. */
export function assertDatabaseReadTarget(connection?: string): void {
  const preview = ["deploy-preview", "branch-deploy"].includes(process.env.CONTEXT ?? "") || process.env.VERCEL_ENV === "preview";
  if (!preview) return;
  let host: string | undefined;
  try { host = connection ? new URL(connection).hostname : process.env.PGHOST; } catch { /* Refuse an unknown preview target. */ }
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(host ?? "")) return;
  throw new Error("PREVIEW_DATABASE_READ_REFUSED: previews use local fixtures instead of remote database connections");
}

export function databaseAddress(connection: string | undefined): string | null {
  try { const url = new URL(connection!); return url.hostname.toLowerCase().replace("-pooler.", ".") + url.pathname; }
  catch { return null; }
}
