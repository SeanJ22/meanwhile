import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeHoldingsReadback, HOLDINGS_READBACK_SQL } from "../lib/control-plane/repository/holdings-readback.ts";
import { BOOTSTRAP_VERSION } from "../lib/control-plane/repository/pg-schema.ts";

test("holdings instrument observes one database snapshot without schema initialization or mutations", () => {
  assert.match(HOLDINGS_READBACK_SQL, /^SELECT/);
  assert.doesNotMatch(HOLDINGS_READBACK_SQL, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  const instrument = readFileSync("scripts/lane-c-readback.mts", "utf8");
  assert.doesNotMatch(instrument, /createPgRepositories|\bbootstrap\(/);
  assert.match(instrument, /readHoldingsControlPlane/);
});

test("readback refuses an empty or structurally incomplete observed denominator", () => {
  const row = { observed_at: "2026-09-02T00:00:00Z", database_name: "control", schema_name: "public", schema_version: BOOTSTRAP_VERSION,
    obligations: [{ id: "observed-obligation" }], occurrences: [], debts: [], route_tasks: [], work_items: [], dispositions: [], artifacts: [] };
  const result = decodeHoldingsReadback([row]);
  assert.equal(result.obligations.length, 1);
  assert.equal(result.source.identity, "WTP_CONTROL_PLANE_DATABASE_URL / control / public");
  assert.equal(result.observed_at, "2026-09-02T00:00:00.000Z");
  assert.throws(() => decodeHoldingsReadback([{ ...row, obligations: [] }]), /zero obligations/);
  assert.throws(() => decodeHoldingsReadback([{ ...row, artifacts: undefined }]), /missing array/);
  assert.throws(() => decodeHoldingsReadback([{ ...row, schema_version: 0 }]), /schema identity/);
});
