/**
 * The governance validator — the half of this architecture that can go RED.
 *
 * A schema without a validator is a convention, and every governance
 * convention in this repository's history was eventually violated by somebody
 * doing their honest best. The point of the typed ledger is not that it is
 * tidy; it is that a contradiction, a stale view, a dangling reference or a
 * session-authored law becomes a FAILING BUILD rather than something a reader
 * has to notice.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findClaimConflicts, validateClaims, type ClaimConflict } from "./claims.ts";
import { LedgerIndex, ROOT } from "./ledger.ts";
import {
  CURRENT_STATUSES,
  DOMAINS,
  FULL_SUPERSESSION,
  type GovernanceRecord,
  type ValidationIssue,
  validateRecord,
} from "./schema.ts";

export interface ValidationReport {
  issues: ValidationIssue[];
  conflicts: ClaimConflict[];
  checked: string[];
}

/**
 * Cross-record structural validation.
 *
 * Single-record checks live in `validateRecord`. Everything here needs to see
 * the whole ledger at once, which is precisely the set of defects a
 * hand-maintained document could never surface.
 */
export function validateLedger(index: LedgerIndex, root: string = ROOT): ValidationReport {
  const issues: ValidationIssue[] = [];
  const checked: string[] = [];
  const records = index.records;
  const bad = (id: string, rule: string, detail: string) => issues.push({ id, rule, detail });

  const check = (name: string) => checked.push(name);

  // --- per-record schema -------------------------------------------------
  check("record-schema");
  for (const r of records) issues.push(...validateRecord(r));

  // --- duplicate ids and aliases -----------------------------------------
  check("duplicate-ids");
  const seenId = new Set<string>();
  const seenAlias = new Map<string, string>();
  for (const r of records) {
    if (seenId.has(r.id)) bad(r.id, "duplicate-id", "id appears more than once in the ledger");
    seenId.add(r.id);
    for (const a of r.aliases) {
      const key = a.toUpperCase();
      const prior = seenAlias.get(key);
      if (prior && prior !== r.id) {
        bad(r.id, "alias-collision", `alias ${a} already resolves to ${prior}`);
      }
      seenAlias.set(key, r.id);
    }
  }

  // --- tombstone ids are never reused ------------------------------------
  check("tombstone-reuse");
  for (const r of records) {
    if (r.kind !== "TOMBSTONE") continue;
    for (const other of records) {
      if (other.id === r.id) continue;
      if (other.aliases.some((a) => r.aliases.includes(a))) {
        bad(r.id, "tombstone-reuse", `tombstoned alias reused by ${other.id}`);
      }
    }
  }

  // --- every legacy reference resolves ------------------------------------
  check("alias-resolution");
  for (const r of records) {
    for (const a of r.aliases) {
      if (index.resolve(a)?.id !== r.id) {
        bad(r.id, "unresolved-alias", `alias ${a} does not resolve back to this record`);
      }
    }
  }

  // --- relations point at records that exist ------------------------------
  check("relation-targets");
  for (const r of records) {
    for (const rel of r.relations) {
      if (!index.has(rel.target)) {
        bad(r.id, "dangling-relation", `${rel.kind} targets missing ${rel.target}`);
      }
    }
  }

  // --- supersession cycles -------------------------------------------------
  check("supersession-cycles");
  const graph = new Map<string, string[]>();
  for (const r of records) {
    graph.set(
      r.id,
      r.relations
        .filter((rel) => rel.kind === "supersedes_full" || rel.kind === "supersedes_clause" || rel.kind === "amends")
        .map((rel) => rel.target),
    );
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>();
  const visit = (id: string, path: string[]): void => {
    const c = colour.get(id) ?? WHITE;
    if (c === BLACK) return;
    if (c === GREY) {
      bad(id, "supersession-cycle", `cycle: ${[...path, id].join(" -> ")}`);
      return;
    }
    colour.set(id, GREY);
    for (const next of graph.get(id) ?? []) visit(next, [...path, id]);
    colour.set(id, BLACK);
  };
  for (const r of records) visit(r.id, []);

  // --- a fully superseded record may not still be current ------------------
  check("superseded-still-current");
  for (const r of records) {
    for (const rel of r.relations) {
      if (!FULL_SUPERSESSION.includes(rel.kind)) continue;
      const target = index.get(rel.target);
      if (target && CURRENT_STATUSES.includes(target.status)) {
        bad(
          target.id,
          "superseded-full-but-current",
          `${r.id} supersedes it in full, yet it is still ${target.status}`,
        );
      }
    }
  }

  // --- semantic contradictions --------------------------------------------
  check("semantic-claims");
  issues.push(...validateClaims(records));
  const conflicts = findClaimConflicts(records);
  for (const c of conflicts) {
    bad(
      c.holders.map((h) => h.id).join(","),
      "semantic-contradiction",
      `${c.key} has ${c.holders.length} active holders with different values: ` +
        c.holders.map((h) => `${h.id}=${h.value}`).join(" | "),
    );
  }

  // --- one rule, one current holder (RULING 247, ruleKey) ------------------
  //
  // The STRUCTURAL guarantee behind "law is written once". A rule slot
  // (`ruleKey`) has exactly one CURRENT holder. A second active LAW_DECISION on
  // the same key is the drain this consolidation drained — a principle re-issued
  // as a new ruling for every incident that illustrated it — and it fails here
  // rather than being noticed. A NON-current record may carry a key to link an
  // incident or a superseded predecessor to the rule it illustrates, but it must
  // then declare a relation to the current holder; an orphan key is a dangling
  // claim of authority.
  check("one-rule-one-holder");
  const currentHolderByKey = new Map<string, string>();
  for (const r of records) {
    if (!r.ruleKey || !CURRENT_STATUSES.includes(r.status) || r.kind !== "LAW_DECISION") continue;
    const prior = currentHolderByKey.get(r.ruleKey);
    if (prior && prior !== r.id) {
      bad(
        `${prior},${r.id}`,
        "duplicate-rulekey",
        `ruleKey ${r.ruleKey} has two current LAW_DECISION holders — one rule may have only one`,
      );
    } else {
      currentHolderByKey.set(r.ruleKey, r.id);
    }
  }
  for (const r of records) {
    if (!r.ruleKey || CURRENT_STATUSES.includes(r.status)) continue;
    const holder = currentHolderByKey.get(r.ruleKey);
    if (!holder) {
      bad(r.id, "rulekey-without-current-holder", `carries ruleKey ${r.ruleKey} but no current LAW_DECISION holds it`);
    } else if (!related(index, r.id, holder)) {
      bad(
        r.id,
        "rulekey-link-missing",
        `carries ruleKey ${r.ruleKey} (held by ${holder}) but declares no relation linking it to that rule`,
      );
    }
  }

  // --- duplicated canonical law -------------------------------------------
  // The acceptance bar is ONE canonical current source per rule, and a bar with
  // no instrument is a wish. Two ACTIVE law records carrying substantially the
  // same operative sentence are two canonical sources for one rule — which is
  // precisely the `CLAUDE.md` / `docs/rulings.md` dual write, wearing new
  // clothes. Comparison is over NORMALIZED SENTENCE SHAPE rather than raw text,
  // because a hand-copied duplicate is never byte-identical (RULING 110).
  check("duplicate-canonical-law");
  const sentenceOwner = new Map<string, string>();
  for (const r of records) {
    if (!CURRENT_STATUSES.includes(r.status) || r.kind !== "LAW_DECISION") continue;
    for (const s of operativeSentences(r.body)) {
      const prior = sentenceOwner.get(s);
      if (prior && prior !== r.id) {
        // Overlap is permitted ONLY where a relation declares the two records
        // to be one rule — a constitution paragraph restating a ruling it is
        // `derived_from`, for instance. The relation is the declaration, and
        // declaring costs a diff. Undeclared overlap is two canonical sources
        // for one rule, which is the dual write, and it fails.
        if (!related(index, prior, r.id)) {
          bad(
            `${prior},${r.id}`,
            "duplicate-canonical-law",
            `both carry the same operative sentence with no relation declaring them one rule: "${s.slice(0, 80)}..."`,
          );
        }
      } else {
        sentenceOwner.set(s, r.id);
      }
    }
  }

  // --- the compatibility view's CONTENT ------------------------------------
  //
  // "generated + registered" was the whole of the old check, and it passed
  // happily while `docs/rulings.md` carried 24 `## RULING undefined` headings
  // on live `main`. A view can be freshly generated, byte-reproducible, and
  // still say nothing that resolves — freshness is not validity.
  //
  // So the content is checked: every `RULING n` row must name a real numeric
  // record, and every numeric record must appear.
  //
  // The view is a one-line-per-ruling index now, not one section per ruling, so
  // the subject is a table ROW (`| RULING n | ...`) rather than an `## RULING n`
  // heading. The invariant is unchanged; only where the number is read moved.
  check("compatibility-view-content");
  const rulingsPath = join(root, "docs", "rulings.md");
  if (existsSync(rulingsPath)) {
    const text = readFileSync(rulingsPath, "utf8");

    const undef = (text.match(/RULING undefined/g) ?? []).length;
    if (undef > 0) {
      bad("docs/rulings.md", "ruling-undefined", `${undef} row(s) render as "RULING undefined"`);
    }

    const rows = [...text.matchAll(/^\| RULING (.+?) \|/gm)].map((m) => m[1].trim());
    const numericIds = new Set(
      records.filter((r) => /^R-0*\d+$/.test(r.id)).map((r) => String(Number(/^R-0*(\d+)$/.exec(r.id)?.[1]))),
    );
    const seenRow = new Set<string>();
    for (const h of rows) {
      if (!/^\d+$/.test(h)) {
        bad("docs/rulings.md", "malformed-ruling-row", `"| RULING ${h} |" is not a ruling number`);
        continue;
      }
      seenRow.add(String(Number(h)));
      if (!numericIds.has(String(Number(h)))) {
        bad(
          "docs/rulings.md",
          "row-without-record",
          `"| RULING ${h} |" resolves to no canonical numeric record`,
        );
      }
    }
    for (const id of numericIds) {
      if (!seenRow.has(id)) {
        bad(
          `R-${id.padStart(4, "0")}`,
          "record-omitted-from-compatibility-view",
          "a numbered ruling is missing from docs/rulings.md, so a legacy reference to it stops resolving",
        );
      }
    }
    // And the un-numbered records are present as themselves, not dropped.
    for (const r of records) {
      if (/^R-0*\d+$/.test(r.id)) continue;
      if (!text.includes(`\`${r.id}\``)) {
        bad(r.id, "unnumbered-record-dropped", "an un-numbered governance record is absent from the compatibility view");
      }
    }
  }

  // --- an ACTIVE rule may not command the retired dual write ---------------
  //
  // Not a prose sweep — a check on the SEMANTIC CLAIM. Two rules can describe
  // the amendment procedure in completely different words and still be the same
  // contradiction, which is exactly why the claim model exists.
  check("one-amendment-procedure");
  const procedureHolders = records
    .filter((r) => CURRENT_STATUSES.includes(r.status))
    .filter((r) => r.claims.some((c) => c.key === "governance.amendment_procedure"));
  const values = new Set(
    procedureHolders.flatMap((r) =>
      r.claims.filter((c) => c.key === "governance.amendment_procedure").map((c) => c.value),
    ),
  );
  if (procedureHolders.length === 0) {
    bad(
      "governance.amendment_procedure",
      "no-amendment-procedure",
      "no ACTIVE record answers how law is amended — a session would have to guess",
    );
  }
  if (values.has("dual-write-claude-and-rulings")) {
    bad(
      procedureHolders.map((r) => r.id).join(","),
      "retired-dual-write-is-current",
      "an ACTIVE rule still commands hand-editing CLAUDE.md and docs/rulings.md, which are now a root " +
        "constitution and a GENERATED view — the procedure it describes cannot be followed",
    );
  }

  // --- policy modules exist and are registered -----------------------------
  check("policy-registration");
  const constitutionPath = join(root, "CLAUDE.md");
  const constitution = existsSync(constitutionPath) ? readFileSync(constitutionPath, "utf8") : "";
  const referenced = new Set<string>();
  for (const r of records) {
    if (!r.operativePolicy) continue;
    referenced.add(r.operativePolicy);
    if (!existsSync(join(root, r.operativePolicy))) {
      bad(r.id, "missing-policy", `operativePolicy does not exist on disk: ${r.operativePolicy}`);
    }
  }
  for (const p of referenced) {
    // The root constitution is the policy INDEX. A policy it does not name is a
    // policy a session opening on the constitution would never find.
    if (constitution && !constitution.includes(p)) {
      bad(p, "policy-not-indexed", "policy module is not registered by the root constitution");
    }
  }
  // And the other direction: a domain with active law must have a policy file.
  for (const d of DOMAINS) {
    const hasLaw = records.some(
      (r) => r.domain === d && r.kind === "LAW_DECISION" && CURRENT_STATUSES.includes(r.status),
    );
    const path = `docs/governance/policies/${d}.md`;
    if (hasLaw && !existsSync(join(root, path))) {
      bad(d, "domain-without-policy", `${d} carries active law but ${path} is missing`);
    }
  }

  // --- retired text may not appear in current generated state --------------
  check("history-in-current-state");
  const currentDecisionsPath = join(root, "docs", "governance", "current-decisions.md");
  if (existsSync(currentDecisionsPath)) {
    const cd = readFileSync(currentDecisionsPath, "utf8");
    for (const r of records) {
      if (CURRENT_STATUSES.includes(r.status)) continue;
      if (r.kind === "TOMBSTONE" && cd.includes(r.id)) {
        bad(r.id, "tombstone-in-current", "a tombstone appears in the current decision view");
      }
      // A superseded record's own id showing up in the CURRENT view means
      // retired operative text is being served as though it governed.
      if (r.status === "SUPERSEDED" && cd.includes(`\`${r.id}\``)) {
        bad(r.id, "superseded-in-current", "superseded record appears in the current decision view");
      }
    }
  }

  return { issues, conflicts, checked };
}

/**
 * The staleness check.
 *
 * A generated view that no longer matches its generator is the exact failure
 * RULING 102 was adopted over — somebody fixed the generator and stopped. Here
 * the test is byte reproduction: regenerate into memory, compare, fail.
 */
export function viewDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function collectCurrent(records: GovernanceRecord[]): GovernanceRecord[] {
  return records.filter((r) => CURRENT_STATUSES.includes(r.status));
}

/**
 * The operative sentences of a rule body, normalized for shape comparison.
 *
 * Only substantial sentences count. A short one ("Two, and the fifth needs a
 * word.") recurs innocently across unrelated rules and would make the duplicate
 * detector fire on prose rhythm rather than on duplicated law — a sweep that
 * reports findings it cannot justify trains its reader to ignore it, which is
 * the cost RULING 115 names.
 */
export function operativeSentences(body: string): string[] {
  return body
    .replace(/\s+/g, " ")
    .replace(/[*`_>#]/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, ""))
    .filter((s) => s.split(" ").length >= 12)
    .filter((s) => !BOILERPLATE.some((re) => re.test(s)));
}

/**
 * Sentences that recur across unrelated rules BY DESIGN.
 *
 * This repository requires that a rule ships with its reasoning, and it says so
 * in a stock formula — "the rationale stays attached, because a stripped rule
 * reads as guidance" — which therefore appears in dozens of records. Likewise
 * the status formula recording that a ruling became law on a date.
 *
 * Those are METADATA about a rule, not the rule. Flagging them would make the
 * duplicate detector fire on prose rhythm, and a sweep that reports findings it
 * cannot justify teaches its reader to skim the next one (RULING 115). Each
 * exclusion is listed with what it is, so the list cannot grow silently into a
 * way of hiding real duplication.
 */
const BOILERPLATE: RegExp[] = [
  // the rule-ships-with-its-reasoning formula
  /^the rationale stays attached/,
  // the "this ruling became law" status formula
  /^law as of \d{8}/,
  /^status law\b/,
  // the supersession bookkeeping formula
  /^supersedes nothing\b/,
];

/** True when either record declares a relation to the other. */
function related(index: LedgerIndex, a: string, b: string): boolean {
  const ra = index.get(a);
  const rb = index.get(b);
  return (
    (ra?.relations.some((rel) => rel.target === b) ?? false) ||
    (rb?.relations.some((rel) => rel.target === a) ?? false)
  );
}
