/**
 * Consolidation conservation + preservation analysis (Session G, 2026-09-03).
 *
 * Measures — never asserts — how the delivered candidate ledger conserves the
 * current-law corpus at the base SHA. Emits:
 *
 *   docs/governance/consolidation-map-2026-09-03.json   §3 conservation map
 *
 * Source bytes are read from the base-SHA ledger (`git show HEAD:...`), never
 * the rewritten candidate, per the brief. Dispositions that require a human
 * semantic read are marked REQUIRES_SEMANTIC_REVIEW, not CONSERVED: a generator
 * may flag likely drift, but only a read proves a clause survived.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { readLedger } from "../lib/governance/ledger.ts";
import { operativeSentences } from "../lib/governance/validate.ts";
import { CURRENT_STATUSES, type GovernanceRecord } from "../lib/governance/schema.ts";

const CAND_PATH = "docs/governance-consolidation-2026-09-03/ledger.jsonl";
const OUT = "docs/governance/consolidation-map-2026-09-03.json";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Base-SHA ledger via git (execFileSync buffer raised — the ledger is ~1MB).
function baseLedger(): GovernanceRecord[] {
  const text = execFileSync("git", ["show", "HEAD:docs/governance/ledger.jsonl"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out: GovernanceRecord[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line) out.push(JSON.parse(line) as GovernanceRecord);
  }
  return out;
}

const base = baseLedger();
const cand = readLedger(CAND_PATH);
const candById = new Map(cand.map((r) => [r.id, r]));
const baseById = new Map(base.map((r) => [r.id, r]));

// Incoming supersession edges in the candidate: target -> [successor ids].
const incoming = new Map<string, Array<{ id: string; kind: string }>>();
for (const r of cand) {
  for (const rel of r.relations) {
    if (rel.kind === "supersedes_full" || rel.kind === "supersedes_clause" || rel.kind === "amends") {
      const arr = incoming.get(rel.target) ?? [];
      arr.push({ id: r.id, kind: rel.kind });
      incoming.set(rel.target, arr);
    }
  }
}

// Clause-overlap heuristic: fraction of a record's operative sentences that
// appear verbatim (normalized) in the union of its successors' bodies.
function overlap(baseBody: string, successorBodies: string[]): { score: number; total: number; hit: number } {
  const sents = operativeSentences(baseBody);
  if (sents.length === 0) return { score: 1, total: 0, hit: 0 };
  const successorSents = new Set(successorBodies.flatMap((b) => operativeSentences(b)));
  let hit = 0;
  for (const s of sents) if (successorSents.has(s)) hit += 1;
  return { score: hit / sents.length, total: sents.length, hit };
}

// --- §4 preservation: every base record's body preserved byte-for-byte -------
const preservation: Array<{ id: string; present: boolean; bodyByteEqual: boolean; variantsEqual: boolean }> = [];
for (const b of base) {
  const c = candById.get(b.id);
  preservation.push({
    id: b.id,
    present: !!c,
    bodyByteEqual: !!c && c.body === b.body,
    variantsEqual: !!c && JSON.stringify(c.variants ?? []) === JSON.stringify(b.variants ?? []),
  });
}

// --- §3 conservation: every base CURRENT record maps somewhere ---------------
const priorOperative = base.filter((r) => CURRENT_STATUSES.includes(r.status));
type Row = {
  sourceRecordId: string;
  sourceKind: string;
  sourceStatus: string;
  sourceTextHash: string;
  sourceSentences: number;
  candidateStatus: string | "MISSING";
  successors: Array<{ id: string; kind: string }>;
  overlapHit: number;
  overlapTotal: number;
  overlapScore: number;
  disposition: string;
  notes: string;
};
const rows: Row[] = [];
for (const b of priorOperative) {
  const c = candById.get(b.id);
  const succ = incoming.get(b.id) ?? [];
  const succBodies = succ.map((s) => candById.get(s.id)?.body ?? "");
  const ov = overlap(b.body, succBodies);
  let disposition: string;
  let notes = "";
  if (!c) {
    disposition = "MISSING_FROM_CANDIDATE";
    notes = "base current record absent from candidate ledger — conservation defect";
  } else if (CURRENT_STATUSES.includes(c.status)) {
    disposition = c.body === b.body ? "CARRIED_ACTIVE_UNCHANGED" : "CARRIED_ACTIVE_BODY_CHANGED";
    if (c.body !== b.body) notes = "same id still current but body edited — verify clause conservation";
  } else if (succ.length === 0) {
    disposition = "SUPERSEDED_NO_SUCCESSOR";
    notes = "candidate marks it non-current but no ruling declares a supersession/amendment edge to it";
  } else {
    // Superseded WITH a successor edge. Overlap heuristic triages the read.
    disposition = ov.score >= 0.6 ? "SUPERSEDED_LIKELY_CONSERVED" : "SUPERSEDED_REQUIRES_SEMANTIC_REVIEW";
    notes = `overlap ${ov.hit}/${ov.total}; successors ${succ.map((s) => s.id).join(",")}`;
  }
  rows.push({
    sourceRecordId: b.id,
    sourceKind: b.kind,
    sourceStatus: b.status,
    sourceTextHash: sha256(b.body),
    sourceSentences: ov.total,
    candidateStatus: c?.status ?? "MISSING",
    successors: succ,
    overlapHit: ov.hit,
    overlapTotal: ov.total,
    overlapScore: Number(ov.score.toFixed(3)),
    disposition,
    notes,
  });
}

const dispCounts: Record<string, number> = {};
for (const r of rows) dispCounts[r.disposition] = (dispCounts[r.disposition] ?? 0) + 1;

const preservationSummary = {
  baseRecords: base.length,
  presentInCandidate: preservation.filter((p) => p.present).length,
  bodyByteEqual: preservation.filter((p) => p.bodyByteEqual).length,
  variantsEqual: preservation.filter((p) => p.variantsEqual).length,
  missing: preservation.filter((p) => !p.present).map((p) => p.id),
  bodyChanged: preservation.filter((p) => p.present && !p.bodyByteEqual).map((p) => p.id),
};

const out = {
  generatedBy: "scripts/consolidation-conserve.mts (Session G)",
  note: "MEASUREMENT, not authority. REQUIRES_SEMANTIC_REVIEW rows are unproven and block conservation (item 4).",
  baseSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  priorOperativeCount: priorOperative.length,
  dispositionCounts: dispCounts,
  preservationSummary,
  rows,
  preservation,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log(`prior operative (base current): ${priorOperative.length}`);
console.log("disposition counts:", JSON.stringify(dispCounts, null, 2));
console.log("preservation:", JSON.stringify(preservationSummary, (k, v) => (Array.isArray(v) && v.length > 12 ? `[${v.length} ids]` : v), 2));
console.log(`\nwrote ${OUT}`);
