import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export const neonConfig = {};
export const types = { builtins: {}, setTypeParser() {}, getTypeParser: () => value => value };
export class Pool { constructor() { throw new Error("migration fixture must never open a pool"); } }

const SQL_PREFIX = "APPLY_MIGRATIONS_FAKE_SQL ";
const EVENT_PREFIX = "APPLY_MIGRATIONS_FAKE_EVENT ";

function textOf(strings) {
  return strings
    .join("?")
    .replace(/\s+/g, " ")
    .trim();
}

function record(prefix, value) {
  process.stdout.write(`${prefix}${JSON.stringify(value)}\n`);
}

function appliedRows() {
  const journal = JSON.parse(readFileSync("lib/db/migrations/meta/_journal.json", "utf8"));
  return (process.env.APPLY_MIGRATIONS_FAKE_APPLIED_WHEN ?? "").split(",").filter(Boolean).map(created_at => {
    const entry = journal.entries.find(entry => entry.when === Number(created_at));
    const hash = process.env.APPLY_MIGRATIONS_FAKE_BAD_HASH === "1" ? "f".repeat(64)
      : createHash("sha256").update(readFileSync(`lib/db/migrations/${entry.tag}.sql`)).digest("hex");
    return { created_at, hash };
  });
}

export function neon(connection) {
  const database = new URL(connection).pathname.slice(1);
  const sql = async (strings) => {
    const statement = textOf(strings);
    record(SQL_PREFIX, statement);
    if (/\bto_regclass\s*\(/i.test(statement)) {
      return [{ exists: process.env.APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS !== "0" }];
    }
    if (/^SELECT\s+hash,\s*created_at\b/i.test(statement)) {
      return appliedRows();
    }
    if (/^SELECT\s+COUNT\(\*\)/i.test(statement)) return [{ n: 1 }];
    return [];
  };

  sql.query = async (text) => { record(SQL_PREFIX, text.replace(/\s+/g, " ").trim()); return []; };
  sql.transaction = async (build, options) => {
    let migration = false;
    const transaction = async (strings) => {
      const statement = textOf(strings);
      record(EVENT_PREFIX, { kind: "transaction-tag", statement });
      if (options?.readOnly && !/^SELECT\b/i.test(statement)) throw Error("read-only fixture received a write");
      if (/\bto_regclass\s*\(/i.test(statement)) return [{ exists: process.env.APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS !== "0" }];
      if (/^SELECT\s+hash,\s*created_at\b/i.test(statement)) return appliedRows();
      if (/AS applied$/i.test(statement)) return [{ applied: process.env.APPLY_MIGRATIONS_FAKE_CONCURRENT === "1" ? false : true }];
      return [];
    };
    transaction.query = async (statement) => {
      if (/^DO\b/.test(statement)) migration = true;
      record(EVENT_PREFIX, { kind: "transaction-query", statement, database });
      if (/AS applied$/i.test(statement)) return [{ applied: process.env.APPLY_MIGRATIONS_FAKE_CONCURRENT === "1" ? false : true }];
      return [];
    };

    const requests = build(transaction);
    record(EVENT_PREFIX, { kind: "transaction", requests: requests.length, ...(options?.readOnly ? { readOnly: true } : {}) });
    if (migration && (process.env.APPLY_MIGRATIONS_FAKE_TRANSACTION_FAIL === "1" ||
      process.env.APPLY_MIGRATIONS_FAKE_TRANSACTION_FAIL_DATABASE === database)) {
      throw new Error("planted transaction failure");
    }
    return Promise.all(requests);
  };

  return sql;
}
