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

export function neon() {
  const sql = async (strings) => {
    const statement = textOf(strings);
    record(SQL_PREFIX, statement);
    if (/\bto_regclass\s*\(/i.test(statement)) {
      return [{ exists: process.env.APPLY_MIGRATIONS_FAKE_JOURNAL_EXISTS !== "0" }];
    }
    if (/^SELECT\s+hash,\s*created_at\b/i.test(statement)) {
      const applied = (process.env.APPLY_MIGRATIONS_FAKE_APPLIED_WHEN ?? "")
        .split(",")
        .filter(Boolean)
        .map((created_at) => ({ created_at, hash: "f".repeat(64) }));
      return applied;
    }
    if (/^SELECT\s+COUNT\(\*\)/i.test(statement)) return [{ n: 1 }];
    return [];
  };

  sql.transaction = async (build) => {
    const transaction = async (strings) => {
      record(EVENT_PREFIX, { kind: "transaction-tag", statement: textOf(strings) });
      return [];
    };
    transaction.query = async (statement) => {
      record(EVENT_PREFIX, { kind: "transaction-query", statement });
      return [];
    };

    const requests = build(transaction);
    record(EVENT_PREFIX, { kind: "transaction", requests: requests.length });
    if (process.env.APPLY_MIGRATIONS_FAKE_TRANSACTION_FAIL === "1") {
      throw new Error("planted transaction failure");
    }
    return Promise.all(requests);
  };

  return sql;
}
