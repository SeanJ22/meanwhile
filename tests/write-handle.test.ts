import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  REFUSED_VARIABLE,
  WRITE_VARIABLE,
  WriteHandleRefused,
  isReadonlyUser,
  resolveProductionWriteHandle,
} from "../lib/db/write-handle.ts";

const PROD_OWNER =
  "postgresql://neondb_owner:secret@ep-dry-river-axwtolzc-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require";
const PROD_READONLY =
  "postgresql://readonly:secret@ep-dry-river-axwtolzc-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require";

test("the sanctioned variable resolves, and reports role and host", () => {
  const handle = resolveProductionWriteHandle({ [WRITE_VARIABLE]: PROD_OWNER });
  assert.equal(handle.variable, WRITE_VARIABLE);
  assert.equal(handle.role, "neondb_owner");
  assert.equal(handle.host, "ep-dry-river-axwtolzc-pooler.c-4.us-east-2.aws.neon.tech");
  assert.equal(handle.database, "neondb");
});

test("PLANTED: the readonly variable asked for BY NAME is refused", () => {
  assert.throws(
    () =>
      resolveProductionWriteHandle(
        { [REFUSED_VARIABLE]: PROD_OWNER, [WRITE_VARIABLE]: PROD_OWNER },
        REFUSED_VARIABLE,
      ),
    (error: unknown) => {
      assert.ok(error instanceof WriteHandleRefused);
      assert.match((error as Error).message, /not a write path/);
      return true;
    },
    "asking for the READONLY variable by name must be refused even when it holds an owner string",
  );
});

test("PLANTED: a readonly connection string in the RIGHT variable is refused", () => {
  assert.throws(
    () => resolveProductionWriteHandle({ [WRITE_VARIABLE]: PROD_READONLY }),
    (error: unknown) => {
      assert.ok(error instanceof WriteHandleRefused);
      assert.match((error as Error).message, /read-only/);
      return true;
    },
    "the right variable holding the wrong string must fail at the script, not mid-migration",
  );
});

test("PLANTED: any other variable name is refused — there is no second door", () => {
  assert.throws(
    () => resolveProductionWriteHandle({ DATABASE_URL: PROD_OWNER }, "DATABASE_URL"),
    WriteHandleRefused,
  );
});

test("an unset write variable refuses rather than falling back", () => {
  assert.throws(
    () => resolveProductionWriteHandle({ [REFUSED_VARIABLE]: PROD_OWNER }),
    (error: unknown) => {
      assert.match((error as Error).message, /is not set/);
      return true;
    },
  );
});

test("isReadonlyUser catches the role and its prefixed variants", () => {
  assert.equal(isReadonlyUser(PROD_READONLY), true);
  assert.equal(isReadonlyUser(PROD_READONLY.replace("readonly:", "readonly_audit:")), true);
  assert.equal(isReadonlyUser(PROD_OWNER), false);
  assert.equal(isReadonlyUser("not a url"), false);
});

const WRITING_SCRIPTS = ["scripts/apply-migrations.mts"];

test("no writing script reads the READONLY variable directly", () => {
  for (const path of WRITING_SCRIPTS) {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    const reads = source.match(/process\.env\.WTP_PRODUCTION_DATABASE_URL_READONLY/g) ?? [];
    assert.equal(
      reads.length,
      0,
      `${path} reads ${REFUSED_VARIABLE} directly — writing scripts resolve through ` +
        `lib/db/write-handle.ts, which refuses it by name`,
    );
    assert.match(
      source,
      /resolveProductionWriteHandle/,
      `${path} can write to production and must resolve its handle through write-handle.ts`,
    );
  }
});
