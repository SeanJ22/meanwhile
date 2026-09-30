/** Static contract fixtures only. Actual deferred-trigger execution still needs isolated Postgres. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../docs/migration-proposals/admin-action-history-cp-v16.sql", import.meta.url), "utf8");
const trigger = sql.split("CREATE OR REPLACE FUNCTION cp_admin_action_history_assert_scope()")[1]?.split("DO $ BEGIN")[0] ?? "";

type Fixture = { readonly scopeKind: "GLOBAL" | "INSTRUCTION"; readonly scope: string;
  readonly actionType: string | null; readonly projectedKind: string | null;
  readonly actionSubject?: string | null; readonly actionOutcome?: string | null;
  readonly originalType?: string | null; readonly originalSubject?: string | null;
  readonly originalOutcome?: string | null; readonly accepted: boolean };

const fixtures: readonly Fixture[] = [
  { scopeKind: "GLOBAL", scope: "us", actionType: "runner.pause", projectedKind: "global-runner-pause", accepted: true },
  { scopeKind: "GLOBAL", scope: "us", actionType: "runner.resume", projectedKind: "global-runner-resume", accepted: true },
  { scopeKind: "GLOBAL", scope: "us", actionType: "runner.pause", projectedKind: "global-runner-resume", accepted: false },
  { scopeKind: "GLOBAL", scope: "us", actionType: null, projectedKind: null, accepted: false },
  { scopeKind: "GLOBAL", scope: "zcta:2020/85635", actionType: "runner.pause", projectedKind: "global-runner-pause", accepted: false },
  { scopeKind: "INSTRUCTION", scope: "zcta:2020/85635", actionType: "expansion.scope.set", projectedKind: null,
    actionSubject: "zcta:2020/85635", actionOutcome: "DONE", originalType: "expansion.scope.set",
    originalSubject: "zcta:2020/85635", originalOutcome: "DONE", accepted: true },
  { scopeKind: "INSTRUCTION", scope: "zcta:2020/85635", actionType: "expansion.scope.set", projectedKind: null,
    actionSubject: "zcta:2020/85635", actionOutcome: "DONE", originalType: "expansion.scope.set",
    originalSubject: "zcta:2020/85635", originalOutcome: "REFUSED", accepted: false },
  { scopeKind: "INSTRUCTION", scope: "zcta:2020/85635", actionType: "expansion.scope.set", projectedKind: null,
    actionSubject: "zcta:2020/85635", actionOutcome: "REFUSED", originalType: "expansion.scope.set",
    originalSubject: "zcta:2020/85635", originalOutcome: "DONE", accepted: false },
  { scopeKind: "INSTRUCTION", scope: "zcta:2020/85635", actionType: "expansion.scope.set", projectedKind: null,
    actionSubject: "zcta:2020/85635", actionOutcome: "DONE", originalType: "expansion.scope.set",
    originalSubject: "zcta:2020/other", originalOutcome: "DONE", accepted: false },
  { scopeKind: "INSTRUCTION", scope: "zcta:2020/85635", actionType: "expansion.scope.set", projectedKind: "hunt-start",
    actionSubject: "zcta:2020/85635", actionOutcome: "DONE", originalType: "expansion.scope.set",
    originalSubject: "zcta:2020/85635", originalOutcome: "DONE", accepted: false },
];

test("staged parity trigger spells out the complete null-safe fixture contract", () => {
  assert(trigger, "the staged scope trigger must be present");
  const global = trigger.split("IF NEW.scope_kind = 'GLOBAL' THEN")[1]?.split("ELSE")[0] ?? "";
  const instruction = trigger.split("IF NEW.scope_kind = 'GLOBAL' THEN")[1]?.split("ELSE")[1] ?? "";
  assert.match(global, /action_type = 'runner\.pause' AND projected_kind = 'global-runner-pause'/);
  assert.match(global, /action_type = 'runner\.resume' AND projected_kind = 'global-runner-resume'/);
  assert.match(global, /\) IS NOT TRUE/, "null types/kinds must be refused");
  assert.match(global, /NEW\.scope_key IS DISTINCT FROM 'us'/);
  for (const clause of [
    "action_type IS DISTINCT FROM 'expansion.scope.set'", "projected_kind IS NOT NULL",
    "action_subject IS DISTINCT FROM NEW.scope_key", "action_outcome IS DISTINCT FROM 'DONE'",
    "original_type IS DISTINCT FROM 'expansion.scope.set'", "original_subject IS DISTINCT FROM NEW.scope_key",
    "original_outcome IS DISTINCT FROM 'DONE'",
  ]) assert(instruction.includes(clause), `missing fail-closed instruction parity: ${clause}`);
  const allowed = (f: Fixture) => f.scopeKind === "GLOBAL"
    ? f.scope === "us" && ((f.actionType === "runner.pause" && f.projectedKind === "global-runner-pause") ||
      (f.actionType === "runner.resume" && f.projectedKind === "global-runner-resume"))
    : f.actionType === "expansion.scope.set" && f.projectedKind === null &&
      f.actionSubject === f.scope && f.actionOutcome === "DONE" &&
      f.originalType === "expansion.scope.set" && f.originalSubject === f.scope && f.originalOutcome === "DONE";
  for (const f of fixtures) assert.equal(allowed(f), f.accepted, JSON.stringify(f));
});
