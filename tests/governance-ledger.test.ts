import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { findClaimConflicts, validateClaims, CLAIM_KEYS } from "../lib/governance/claims.ts";
import { LedgerIndex, loadIndex, serializeRecord } from "../lib/governance/ledger.ts";
import {
  CURRENT_STATUSES,
  canonicalId,
  parseLegacyAlias,
  validateRecord,
  type GovernanceRecord,
} from "../lib/governance/schema.ts";
import { validateLedger, operativeSentences } from "../lib/governance/validate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * These guards protect the property the whole remediation exists to create:
 * a session can answer "what is true now?" from compiled current authority,
 * without reasoning through chronology.
 *
 * They test the DERIVED case, not one migrated ruling. A test that only
 * asserted RULING 26 survived the migration would prove the migration handled
 * RULING 26.
 */

function fixture(over: Partial<GovernanceRecord> = {}): GovernanceRecord {
  return {
    id: "R-9001",
    aliases: ["RULING 9001"],
    kind: "LAW_DECISION",
    status: "ACTIVE",
    provenance: "author_explicit",
    domain: "discovery",
    title: "a test rule",
    adopted: "2026-08-26",
    body: "body",
    variants: [],
    relations: [],
    operativePolicy: "docs/governance/policies/discovery.md",
    claims: [],
    uncertain: [],
    routingNotes: [],
    sourceRef: "test",
    ...over,
  };
}

test("a session may not legislate — binding kinds require author provenance", () => {
  const sessionAuthored = fixture({ provenance: "session_interpretation" });
  const issues = validateRecord(sessionAuthored);
  assert.ok(
    issues.some((i) => i.rule === "binding-provenance"),
    "a LAW_DECISION with session_interpretation provenance must be refused",
  );

  // And the same record as a non-binding INTERPRETATION is fine — the model
  // records its reading, it just does not become the rule.
  assert.equal(
    validateRecord(fixture({ provenance: "session_interpretation", kind: "INTERPRETATION", operativePolicy: null }))
      .length,
    0,
  );
});

test("a FACT may not be emitted as a current normative instruction", () => {
  const measurement = fixture({
    kind: "FACT",
    operativePolicy: null,
    claims: [{ key: "verification.target", value: "production" }],
  });
  assert.ok(validateRecord(measurement).some((i) => i.rule === "fact-as-instruction"));
});

test("a TOMBSTONE may not read as current, and its id is never reused", () => {
  const t = fixture({ kind: "TOMBSTONE", status: "ACTIVE", adopted: null, operativePolicy: null });
  assert.ok(validateRecord(t).some((i) => i.rule === "tombstone-status"));

  const index = new LedgerIndex([
    fixture({ id: "R-9001", kind: "TOMBSTONE", status: "RETIRED", adopted: null, aliases: ["RULING 9001"], operativePolicy: null }),
    fixture({ id: "R-9002", aliases: ["RULING 9001"] }),
  ]);
  const { issues } = validateLedger(index, ROOT);
  assert.ok(issues.some((i) => i.rule === "tombstone-reuse"), "a reused tombstoned alias must fail");
});

test("a partial amendment must name what changed AND what survives", () => {
  const unscoped = fixture({ relations: [{ kind: "amends", target: "R-0094" }] });
  assert.ok(validateRecord(unscoped).some((i) => i.rule === "unscoped-partial"));

  const scoped = fixture({
    relations: [
      { kind: "amends", target: "R-0094", changed: "what the end of the moves means", survives: "the five moves stand" },
    ],
  });
  assert.equal(validateRecord(scoped).filter((i) => i.rule === "unscoped-partial").length, 0);
});

test("two ACTIVE records claiming one rule slot differently is a build failure", () => {
  const a = fixture({ id: "R-9001", claims: [{ key: "verification.target", value: "production" }] });
  const b = fixture({
    id: "R-9002",
    aliases: ["RULING 9002"],
    claims: [{ key: "verification.target", value: "local-production-build" }],
  });
  const conflicts = findClaimConflicts([a, b]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "verification.target");

  // ...and marking the older one SUPERSEDED resolves it, which is the whole
  // point of the status model: history stops competing with current law.
  assert.equal(findClaimConflicts([{ ...a, status: "SUPERSEDED" }, b]).length, 0);
});

test("a claim on an undeclared key, or an undeclared value, is refused", () => {
  assert.ok(
    validateClaims([fixture({ claims: [{ key: "made.up.key", value: "x" }] })]).some(
      (i) => i.rule === "undeclared-claim-key",
    ),
  );
  assert.ok(
    validateClaims([fixture({ claims: [{ key: "verification.target", value: "staging" }] })]).some(
      (i) => i.rule === "claim-value",
    ),
  );
});

test("supersession cycles are caught", () => {
  const index = new LedgerIndex([
    fixture({ id: "R-9001", aliases: ["RULING 9001"], relations: [{ kind: "supersedes_full", target: "R-9002" }] }),
    fixture({ id: "R-9002", aliases: ["RULING 9002"], status: "SUPERSEDED", operativePolicy: null, relations: [{ kind: "supersedes_full", target: "R-9001" }] }),
  ]);
  assert.ok(validateLedger(index, ROOT).issues.some((i) => i.rule === "supersession-cycle"));
});

test("a fully superseded record may not still be current", () => {
  const index = new LedgerIndex([
    fixture({ id: "R-9001", aliases: ["RULING 9001"], relations: [{ kind: "supersedes_full", target: "R-9002" }] }),
    fixture({ id: "R-9002", aliases: ["RULING 9002"], status: "ACTIVE" }),
  ]);
  assert.ok(validateLedger(index, ROOT).issues.some((i) => i.rule === "superseded-full-but-current"));
});

test("undeclared duplicate canonical law fails; a declared relation permits it", () => {
  const sentence =
    "Every session ends by running the standing regression net and a prior win that fails is a named regression forever.";
  const a = fixture({ id: "R-9001", aliases: ["RULING 9001"], body: sentence });
  const b = fixture({ id: "R-9002", aliases: ["RULING 9002"], body: sentence });
  assert.ok(
    validateLedger(new LedgerIndex([a, b]), ROOT).issues.some((i) => i.rule === "duplicate-canonical-law"),
    "two canonical sources for one rule must fail",
  );

  const declared = { ...b, relations: [{ kind: "derived_from" as const, target: "R-9001" }] };
  assert.equal(
    validateLedger(new LedgerIndex([a, declared]), ROOT).issues.filter(
      (i) => i.rule === "duplicate-canonical-law",
    ).length,
    0,
    "a declared relation says these are ONE rule",
  );
});

test("boilerplate does not fire the duplicate detector", () => {
  // This repository requires a rule to ship with its reasoning, and says so in
  // a stock formula that appears in dozens of records. Flagging it would train
  // a reader to skim real findings.
  const s = operativeSentences(
    "*The rationale stays attached, because a stripped rule reads as guidance.* " +
      "This sentence is a genuinely substantive operative rule about a real thing here.",
  );
  assert.ok(!s.some((x) => x.startsWith("the rationale stays attached")));
  assert.equal(s.length, 1);
});

test("legacy RULING references still resolve after the migration", () => {
  const index = loadIndex();
  for (const n of [1, 26, 52, 61, 94, 125, 166, 169, 170, 171]) {
    const byLegacy = index.resolve(`RULING ${n}`);
    assert.ok(byLegacy, `RULING ${n} must resolve`);
    assert.equal(byLegacy.id, canonicalId(n));
    assert.equal(index.resolve(canonicalId(n))?.id, canonicalId(n));
    assert.equal(parseLegacyAlias(`RULING ${n}`), canonicalId(n));
  }
});

test("every ruling id CLAUDE.md cites resolves to a record", () => {
  const index = loadIndex();
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const missing: string[] = [];
  for (const m of claude.matchAll(/RULING\s+(\d+)/gi)) {
    if (!index.resolve(`RULING ${m[1]}`)) missing.push(m[1]);
  }
  assert.deepEqual(missing, [], `dangling ruling references in the constitution: ${missing.join(", ")}`);
});

test("the real ledger passes every structural check", () => {
  const { issues, conflicts } = validateLedger(loadIndex(), ROOT);
  assert.deepEqual(
    issues.map((i) => `${i.id} ${i.rule}`),
    [],
    "the committed ledger must validate",
  );
  assert.equal(conflicts.length, 0);
});

test("no record with uncertain provenance binds", () => {
  for (const r of loadIndex().records) {
    if (r.uncertain.length === 0) continue;
    assert.ok(
      r.kind !== "LAW_DECISION" && r.kind !== "DECISION",
      `${r.id} carries uncertainty and must not bind`,
    );
  }
});

test("every active LAW_DECISION names where its operative text lives", () => {
  for (const r of loadIndex().records) {
    if (r.kind !== "LAW_DECISION" || !CURRENT_STATUSES.includes(r.status)) continue;
    assert.ok(r.operativePolicy, `${r.id} is active law with no policy pointer`);
  }
});

test("every declared rule slot has exactly one current answer", () => {
  const index = loadIndex();
  for (const key of CLAIM_KEYS) {
    const holders = index
      .records.filter((r) => CURRENT_STATUSES.includes(r.status))
      .filter((r) => r.claims.some((c) => c.key === key.key));
    assert.ok(holders.length <= 1, `${key.key} has ${holders.length} active holders`);
  }
});

test("the ledger serializer round-trips byte-identically", () => {
  // Without this, every regeneration reads as an edit and the append-only
  // property becomes unreadable in a diff.
  for (const r of loadIndex().records.slice(0, 40)) {
    assert.equal(serializeRecord(JSON.parse(serializeRecord(r)) as GovernanceRecord), serializeRecord(r));
  }
});
