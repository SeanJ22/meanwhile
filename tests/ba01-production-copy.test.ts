import assert from "node:assert/strict";
import test from "node:test";
import { BA01_COPY, requireBa01ProductionCopy } from "../scripts/ba01-production-copy.mts";

const isolated = () => ({ BA01_COPY_HOST: BA01_COPY.host, DATABASE_URL: `postgresql://test:test@${BA01_COPY.host}/test`,
  WTP_CONTROL_PLANE_DATABASE_URL: `postgresql://test:test@${BA01_COPY.host}/test`, WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local" });

test("BA-01 verification refuses an inherited production URL even when staging is declared", () => {
  const env = isolated();
  env.DATABASE_URL = "postgresql://test:test@production.invalid/test";
  assert.throws(() => requireBa01ProductionCopy(env), /Refusing every endpoint except the BA-01 child/);
});

test("BA-01 verification keeps both database targets on the known isolated child", () => {
  assert.equal(requireBa01ProductionCopy(isolated()), isolated().DATABASE_URL);
  assert.throws(() => requireBa01ProductionCopy({ ...isolated(), WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://test:test@other.invalid/test" }), /All test operations must stay on the copy/);
  assert.throws(() => requireBa01ProductionCopy({ ...isolated(), WTP_RUNTIME_MODE: "production" }), /requires staging mode/);
  assert.throws(() => requireBa01ProductionCopy({ ...isolated(), BA01_COPY_HOST: undefined }), /Name the known BA-01 child endpoint explicitly/);
});
