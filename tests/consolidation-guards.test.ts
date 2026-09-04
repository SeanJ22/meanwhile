/**
 * Guards for the 2026-09-03 governance consolidation.
 *
 * These are the NEGATIVE CONTROLS and conservation guards the landing directive
 * required: they fail if the compiler regains the power to rewrite the ledger,
 * if `ruleKey` uniqueness stops being enforced, if a repaired conservation hole
 * reopens, or if a resolved contradiction returns. They test invariants of the
 * consolidated corpus, not one migrated ruling.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadIndex, LedgerIndex } from "../lib/governance/ledger.ts";
import { validateLedger } from "../lib/governance/validate.ts";
import { currentLawText } from "../lib/governance/current-law.ts";
import { CURRENT_STATUSES, type GovernanceRecord } from "../lib/governance/schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const flat = (s: string) => s.replace(/\s+/g, " ");
const law = () => flat(currentLawText(ROOT));

function fixture(over: Partial<GovernanceRecord> = {}): GovernanceRecord {
  return {
    id: "R-9001", aliases: ["RULING 9001"], kind: "LAW_DECISION", status: "ACTIVE",
    provenance: "author_explicit", domain: "meta-governance", title: "fixture",
    adopted: "2026-09-03", body: "A fixture rule with a sufficiently long operative sentence to be seen.",
    variants: [], relations: [], operativePolicy: "docs/governance/policies/meta-governance.md",
    ruleKey: "meta-governance.fixture", claims: [], uncertain: [], routingNotes: [], sourceRef: "test",
    ...over,
  };
}

// --- NEGATIVE CONTROL: the compiler can never rewrite the ledger -------------
test("governance:compile imports no overlay and never writes the ledger", () => {
  const src = readFileSync(join(ROOT, "scripts/governance-compile.mts"), "utf8");
  // The overlay modules are the machinery that once recreated superseded records
  // on every compile. After the cutover the compiler must not import them.
  assert.ok(!/from "\.\.\/lib\/governance\/adoptions\.ts"/.test(src), "compiler still imports adoptions overlay");
  assert.ok(!/from "\.\.\/lib\/governance\/classification\.ts"/.test(src), "compiler still imports classification overlay");
  // And it must not call writeLedger — a generator that rewrites its canonical
  // input is a mirror that loses whatever the input stops saying.
  assert.ok(!/writeLedger\s*\(/.test(src), "compiler still calls writeLedger");
  // The read-only self-guard is present.
  assert.match(src, /must be read-only on the canonical ledger/);
});

// --- NEGATIVE CONTROL: ruleKey uniqueness --------------------------------------
test("a duplicate ruleKey on two current law records is refused", () => {
  const idx = new LedgerIndex([
    fixture({ id: "R-9001", aliases: ["RULING 9001"], ruleKey: "meta-governance.dup" }),
    fixture({ id: "R-9002", aliases: ["RULING 9002"], ruleKey: "meta-governance.dup" }),
  ]);
  const issues = validateLedger(idx, ROOT).issues;
  assert.ok(issues.some((i) => i.rule === "duplicate-rulekey"), "duplicate ruleKey was not caught");
});

test("an active LAW_DECISION with no ruleKey is refused", () => {
  const idx = new LedgerIndex([fixture({ ruleKey: null })]);
  const issues = validateLedger(idx, ROOT).issues;
  assert.ok(issues.some((i) => i.rule === "law-without-rulekey"), "missing ruleKey was not caught");
});

test("a non-current record carrying a ruleKey must link to the current holder", () => {
  const idx = new LedgerIndex([
    fixture({ id: "R-9001", aliases: ["RULING 9001"], ruleKey: "meta-governance.k" }),
    fixture({ id: "R-9002", aliases: ["RULING 9002"], status: "SUPERSEDED", operativePolicy: null, ruleKey: "meta-governance.k" }),
  ]);
  const issues = validateLedger(idx, ROOT).issues;
  assert.ok(issues.some((i) => i.rule === "rulekey-link-missing"), "orphan-keyed superseded record not caught");
});

// --- the real ledger: one holder per key, and every current law is keyed ------
test("the real ledger has exactly one current holder per ruleKey and keys every current law", () => {
  const idx = loadIndex();
  const report = validateLedger(idx, ROOT);
  assert.equal(report.issues.filter((i) => i.rule === "duplicate-rulekey").length, 0);
  assert.equal(report.issues.filter((i) => i.rule === "law-without-rulekey").length, 0);
  const law = idx.records.filter((r) => CURRENT_STATUSES.includes(r.status) && r.kind === "LAW_DECISION");
  assert.ok(law.length >= 30 && law.every((r) => r.ruleKey), "some current law record has no ruleKey");
});

// --- CONSERVATION: the fourteen numbered retrieval rungs survive --------------
test("the fourteen numbered retrieval-mechanics rungs and walledAtRung survive verbatim", () => {
  const t = law();
  assert.match(t, /FOURTEEN numbered rungs/, "the rung count is gone");
  assert.match(t, /walledAtRung/, "walledAtRung semantics are gone");
  assert.match(t, /bulk file is rung ZERO/, "rung zero is gone");
  for (const anchor of ["committed snapshot", "TLS fingerprint passes", "LIVE BROWSER", "Internet Archive", "author's browser, last"]) {
    assert.ok(t.includes(anchor), `rung meaning lost: ${anchor}`);
  }
});

// --- CONSERVATION: the repaired LOST clauses stay in current law --------------
test("the repaired conservation holes remain in current law", () => {
  const t = law();
  assert.match(t, /Zero at a tier fails loudly/i, "R-0169 zero-fails-loudly lost");
  assert.match(t, /only ever TIGHTEN what closes an obligation/i, "R-0198 tighten-only lost");
  assert.match(t, /LITERAL query or URL/i, "R-0088 literal-query lost");
  assert.match(t, /one row per session listing the N photos/i, "R-0055 photo-row lost");
  assert.match(t, /Merge cadence is not session cadence/i, "R-0189 merge-cadence lost");
  assert.match(t, /keep working while authorized/i, "R-0189 keep-working / resumability lost");
  assert.match(t, /denominator is not a membership proof/i, "R-0193 denominator lost");
});

// --- CONTRADICTIONS resolved (§6) --------------------------------------------
test("NEEDS_OWNER is gone from current law; NEEDS_SEAN is the one owner-terminal state", () => {
  const t = law();
  assert.ok(!/NEEDS_OWNER/.test(t), "NEEDS_OWNER still appears in current law");
  assert.match(t, /NEEDS_SEAN|Needs Sean/, "NEEDS_SEAN is absent");
});

test("history never overrides: the reversed clause is gone", () => {
  const t = law();
  assert.ok(!/older text in history governs the reading/.test(t), "history-governs clause survived");
  assert.match(t, /History explains( a rule)?; (it|History) never overrides/i, "history-never-overrides is absent");
});

test("the permission enum names all four states", () => {
  const t = law();
  for (const s of ["ALLOWED", "DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE"]) {
    assert.ok(t.includes(s), `permission state missing: ${s}`);
  }
});

test("the frontier is unordered and carries no priority sequence", () => {
  const f = readFileSync(join(ROOT, "docs/frontier.md"), "utf8");
  assert.ok(!/in priority order/i.test(f), "frontier still claims a priority order");
});

// --- current-decisions carries only DECISION records -------------------------
test("current-decisions.md promotes no LAW_DECISION", () => {
  const idx = loadIndex();
  const cd = readFileSync(join(ROOT, "docs/governance/current-decisions.md"), "utf8");
  for (const r of idx.records) {
    if (r.kind === "LAW_DECISION" && cd.includes(`\`${r.id}\``)) {
      assert.fail(`a LAW_DECISION appears in current-decisions.md: ${r.id}`);
    }
  }
});

// --- numbering (§6): 88/89 issued then superseded, 11 retired ----------------
test("numbering facts: 88 and 89 were issued and superseded; 11 is a retired id", () => {
  const idx = loadIndex();
  for (const n of ["R-0088", "R-0089"]) {
    const r = idx.get(n as GovernanceRecord["id"]);
    assert.ok(r, `${n} does not exist`);
    assert.equal(r!.status, "SUPERSEDED", `${n} must be SUPERSEDED (issued then superseded)`);
  }
  const r11 = idx.get("R-0011" as GovernanceRecord["id"]);
  assert.ok(r11 && (r11.kind === "TOMBSTONE" || r11.status === "RETIRED"), "R-0011 must be a retired id");
});

// --- §7: every ruling CLAUDE.md cites as a rule-carrier is ACTIVE -------------
test("every ruling cited in CLAUDE.md as a rule carrier resolves and is current", () => {
  const idx = loadIndex();
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  // Rule-carrier citations are the trailing "(nnn)" tags on non-negotiable lines
  // and the "(RULING nnn)" section headers.
  const nums = new Set<string>();
  for (const m of claude.matchAll(/\((?:RULING\s+)?(\d{2,4})\)/g)) nums.add(m[1]);
  assert.ok(nums.size > 15, "found too few CLAUDE.md ruling citations — parser drift");
  for (const n of nums) {
    const r = idx.resolve(n);
    assert.ok(r, `CLAUDE.md cites RULING ${n} which resolves to no record`);
    assert.ok(CURRENT_STATUSES.includes(r!.status), `CLAUDE.md cites RULING ${n} as a rule carrier but it is ${r!.status}`);
  }
});
