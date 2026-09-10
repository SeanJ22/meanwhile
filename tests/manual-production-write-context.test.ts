import assert from "node:assert/strict";
import test from "node:test";

import {
  CIVIC_DATA_PROMOTION_OPERATION,
  CIVIC_DATA_PROMOTION_SANCTION,
  prepareProductionCivicDataWrite,
} from "../lib/civic-data/production-write.ts";
import { ProductionWriteRefused } from "../lib/db/write-guard.ts";
import { WriteHandleRefused } from "../lib/db/write-handle.ts";
import { RuntimeAuthorityRefused } from "../lib/civic-data/runtime-authority.ts";

const OWNER =
  "postgresql://neondb_owner:secret@example.neon.tech/production?sslmode=require";
const READ_ONLY =
  "postgresql://readonly_app:secret@example.neon.tech/production?sslmode=require";

test("an explicit data promotion establishes the sanctioned handle but refuses without exact runtime authority", () => {
  const env: Record<string, string | undefined> = {
    WTP_PRODUCTION_DATABASE_URL_WRITE: OWNER,
  };
  assert.throws(() => prepareProductionCivicDataWrite(env), RuntimeAuthorityRefused);
  assert.equal(env.DATABASE_URL, OWNER);
  assert.equal(env.WTP_DB_ROLE, "production");
  assert.equal(env.WTP_SANCTIONED_WRITE, CIVIC_DATA_PROMOTION_SANCTION);
  assert.equal(CIVIC_DATA_PROMOTION_OPERATION, "a routine civic data candidate/version promotion");
});

test("the data-promotion context never falls back to a nearby DATABASE_URL", () => {
  assert.throws(
    () => prepareProductionCivicDataWrite({ DATABASE_URL: OWNER }),
    WriteHandleRefused,
  );
});

test("the data-promotion context refuses a read-only production identity", () => {
  assert.throws(
    () =>
      prepareProductionCivicDataWrite({
        WTP_PRODUCTION_DATABASE_URL_WRITE: READ_ONLY,
      }),
    WriteHandleRefused,
  );
});

test("the named sanction remains operation-scoped", async () => {
  const { assertWriteAllowed } = await import("../lib/db/write-guard.ts");
  const env: Record<string, string | undefined> = {
    DATABASE_URL: OWNER,
    WTP_PRODUCTION_DATABASE_URL_WRITE: OWNER,
    WTP_DB_ROLE: "production",
    WTP_SANCTIONED_WRITE: CIVIC_DATA_PROMOTION_SANCTION,
  };
  assert.throws(() => assertWriteAllowed("an unrelated production write", env), ProductionWriteRefused);
});
