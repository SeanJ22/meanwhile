/** Long migration transaction with a durable, provable commit boundary.
 *
 * The direct PostgreSQL connection avoids a short HTTP gateway deadline.
 * If the connection dies, a fresh connection waits on the same transaction-
 * scoped advisory lock before reading the exact journal hash. An unresolved
 * lock or a conflicting journal row is UNKNOWN, never permission to retry.
 */
export interface DirectMigrationClient {
  query(sql: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}

export interface DirectMigrationPool {
  connect(): Promise<DirectMigrationClient>;
}

export interface DirectMigrationInput {
  readonly pool: DirectMigrationPool;
  readonly tag: string;
  readonly when: number;
  readonly hash: string;
  readonly statements: readonly string[];
}

export type DirectMigrationOutcome = "COMMITTED" | "RECONCILED_COMMITTED";

export class DirectMigrationNotCommitted extends Error {
  readonly code = "DIRECT_MIGRATION_NOT_COMMITTED";
  constructor(tag: string, reason: string) { super(`${tag}: ${reason}`); this.name = "DirectMigrationNotCommitted"; }
}

export class DirectMigrationOutcomeUnknown extends Error {
  readonly code = "DIRECT_MIGRATION_OUTCOME_UNKNOWN";
  constructor(tag: string, reason: string) { super(`${tag}: ${reason}`); this.name = "DirectMigrationOutcomeUnknown"; }
}

const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended($1,0))";
const JOURNAL_SQL = "SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1";
const JOURNAL_INSERT_SQL = "INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2)";

function problem(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function reconcile(input: DirectMigrationInput): Promise<"COMMITTED" | "ABSENT" | "UNKNOWN"> {
  let client: DirectMigrationClient | null = null;
  try {
    client = await input.pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query(LOCK_SQL, [input.tag]);
    const read = await client.query(JOURNAL_SQL, [input.when]);
    await client.query("COMMIT");
    if (read.rows.length === 0) return "ABSENT";
    if (read.rows.length === 1 && read.rows[0]?.hash === input.hash) return "COMMITTED";
    return "UNKNOWN";
  } catch {
    if (client !== null) await client.query("ROLLBACK").catch(() => undefined);
    return "UNKNOWN";
  } finally {
    client?.release();
  }
}

/** Execute one migration exactly once. No automatic retry of uncertain work. */
export async function applyDirectMigration(input: DirectMigrationInput): Promise<DirectMigrationOutcome> {
  if (input.statements.length === 0) throw new DirectMigrationNotCommitted(input.tag, "the migration has no statements");
  let client: DirectMigrationClient | null = null;
  let commitSent = false;
  let rollbackProved = false;
  let failure: unknown = null;
  try {
    client = await input.pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query(LOCK_SQL, [input.tag]);
    // The plan's pending list was read before this lock. Another applier may
    // have committed while we waited; never execute its statements a second
    // time, even when both invocations started from the same pending list.
    const existing = await client.query(JOURNAL_SQL, [input.when]);
    if (existing.rows.length > 0) {
      if (existing.rows.length !== 1 || existing.rows[0]?.hash !== input.hash)
        throw new DirectMigrationOutcomeUnknown(input.tag, "the locked journal contains a conflicting or duplicate receipt; stop without retry");
      commitSent = true;
      await client.query("COMMIT");
      return "RECONCILED_COMMITTED";
    }
    for (const statement of input.statements) await client.query(statement);
    await client.query(JOURNAL_INSERT_SQL, [input.hash, input.when]);
    commitSent = true;
    await client.query("COMMIT");
    return "COMMITTED";
  } catch (error) {
    failure = error;
    if (!commitSent && client !== null) {
      try { await client.query("ROLLBACK"); rollbackProved = true; }
      catch { /* A lost connection requires independent journal reconciliation. */ }
    }
  } finally {
    client?.release(failure !== null && !rollbackProved);
  }
  if (failure instanceof DirectMigrationOutcomeUnknown) throw failure;
  if (rollbackProved) throw new DirectMigrationNotCommitted(input.tag, `transaction rolled back after ${problem(failure)}`);
  const state = await reconcile(input);
  if (state === "COMMITTED") return "RECONCILED_COMMITTED";
  if (state === "ABSENT") throw new DirectMigrationNotCommitted(input.tag, `journal absent after the prior transaction resolved: ${problem(failure)}`);
  throw new DirectMigrationOutcomeUnknown(input.tag, `the commit outcome could not be proved: ${problem(failure)}; stop without retry`);
}

/** The same sanctioned Neon credential, on its direct host instead of pooler. */
export function directNeonConnectionUrl(connection: string): string {
  const url = new URL(connection);
  if (!/^(postgres|postgresql):$/.test(url.protocol) || !url.hostname.endsWith(".neon.tech"))
    throw new Error("DIRECT_MIGRATION_NEON_HOST_REQUIRED");
  const [endpoint, ...suffix] = url.hostname.split(".");
  if (!endpoint.startsWith("ep-") || suffix.length < 2) throw new Error("DIRECT_MIGRATION_NEON_HOST_REQUIRED");
  url.hostname = [endpoint.replace(/-pooler$/, ""), ...suffix].join(".");
  return url.toString();
}
