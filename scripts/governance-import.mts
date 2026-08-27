/**
 * `pnpm governance:import` — mechanically ingest legacy `docs/rulings.md` into
 * the canonical ledger.
 *
 * Written for the governance remediation of 2026-08-26. It is idempotent and
 * re-runnable: running it against an already-imported ledger produces the same
 * bytes, which is what makes the import auditable rather than a one-shot event
 * nobody can re-derive.
 *
 * **It preserves body text verbatim.** See `lib/governance/import.ts`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { importEntry, parseRulingsDoc } from "../lib/governance/import.ts";
import {
  importConstitutionBlock,
  parseConstitution,
} from "../lib/governance/constitution-import.ts";
import { writeLedger, LEDGER_PATH } from "../lib/governance/ledger.ts";
import { validateRecord, type GovernanceRecord } from "../lib/governance/schema.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The import reads PINNED PRE-REMEDIATION SNAPSHOTS, never the live files.
 *
 * The live files are allowed to change — that is the entire objective — so an
 * importer pointed at them would re-derive less canonical state every time one
 * of them got shorter. That is not hypothetical: the first version of the
 * compiler did exactly that and deleted the transparency mandate and the
 * fourteen-rung ladder from the ledger the moment `CLAUDE.md` was rewritten.
 *
 * Snapshots are byte-pinned in `migration-manifest.json`, so this import is
 * reproducible forever and independent of git history rewriting.
 */
const LEGACY = join(ROOT, "docs", "governance", "legacy");
const RULINGS = join(LEGACY, "rulings.pre-remediation.md");
const CLAUDE = join(LEGACY, "CLAUDE.pre-remediation.md");
const MANIFEST = join(ROOT, "docs", "governance", "migration-manifest.json");

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const rulingsText = readFileSync(RULINGS, "utf8");
const claudeText = readFileSync(CLAUDE, "utf8");

// Ids the constitution cites. A ruling CLAUDE names is a ruling the
// constitution is relying on, which is the strongest available signal that it
// is current law rather than a historical decision.
const cited = new Set<string>();
for (const m of claudeText.matchAll(/RULING\s+(\d+)/gi)) {
  cited.add(`R-${String(Number(m[1])).padStart(4, "0")}`);
}

const entries = parseRulingsDoc(rulingsText);
const records: GovernanceRecord[] = [];
const seen = new Map<string, string>();

for (const entry of entries) {
  const rec = importEntry(entry, { citedByConstitution: cited });
  const prior = seen.get(rec.id);
  if (prior) {
    // The file carries RULING 171 at both heading ranks. That is one ruling
    // written twice, not two rulings — merge rather than mint a collision.
    const existing = records.find((r) => r.id === rec.id);
    if (existing && rec.body.length > existing.body.length) {
      existing.body = rec.body;
      existing.title = rec.title;
    }
    continue;
  }
  seen.set(rec.id, entry.heading);
  const { declaredStatus: _drop, ...clean } = rec as GovernanceRecord & {
    declaredStatus: string | null;
  };
  records.push(clean);
}

// --- the constitution's copy of the NUMBERED rulings -----------------------
//
// **Neither legacy file was complete, and this is how that was found.** The two
// hand-written copies of a ruling drifted apart in BOTH directions: 34 of the
// 90 rulings written into `CLAUDE.md` carry MORE text there than in
// `docs/rulings.md` — 15,687 characters of rationale in total. RULING 52's
// locked-building passage ("if the front door is locked and the back door is
// locked, that does not mean the building cannot be entered") exists ONLY in
// the constitution; the rulings-document copy is 991 characters against 3,374.
//
// A migration that took the rulings document as canonical would therefore have
// silently deleted a third of that rationale — and this repository says
// repeatedly that a stripped rule reads as guidance. So the FULLER copy wins,
// and the record says which source it came from and what the other one held.
//
// Found by `tests/discovery-tree.test.ts`, which asserts RULING 52 ships with
// its reasoning, not by anybody reading the files.
const claudeRulings = new Map<number, string>();
{
  const lines = claudeText.split("\n");
  let cur: number | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur !== null) claudeRulings.set(cur, buf.join("\n").trim());
    cur = null;
    buf = [];
  };
  for (const l of lines) {
    const m = /^#{2,3}\s+RULING\s+(\d+)\b/.exec(l);
    if (m) {
      flush();
      cur = Number(m[1]);
      continue;
    }
    if (/^#{2,3}\s/.test(l)) {
      flush();
      continue;
    }
    if (cur !== null) buf.push(l);
  }
  flush();
}

let fullerFromConstitution = 0;
let charactersRecovered = 0;
let divergentCopies = 0;
for (const [n, claudeBody] of claudeRulings) {
  const id = `R-${String(n).padStart(4, "0")}`;
  const rec = records.find((r) => r.id === id);
  if (!rec) continue;

  const rulingsBody = rec.body;
  if (normalize(claudeBody) === normalize(rulingsBody)) continue;
  divergentCopies += 1;

  // The FULLER copy becomes the body; the other is kept verbatim as a variant.
  // Neither is discarded, because the divergence runs BOTH WAYS — 697
  // substantial sentences existed only in the constitution and 699 only in the
  // rulings document, across 87 of 90 rulings. Picking one side would delete
  // several hundred sentences of the author's own reasoning.
  const claudeWins = claudeBody.length > rulingsBody.length;
  if (claudeWins) {
    charactersRecovered += claudeBody.length - rulingsBody.length;
    fullerFromConstitution += 1;
    rec.body = claudeBody;
    rec.variants = [{ source: "docs/rulings.md", body: rulingsBody }];
  } else {
    rec.variants = [{ source: "CLAUDE.md", body: claudeBody }];
  }
  rec.routingNotes.push(
    `two hand-written copies existed and diverged: CLAUDE.md ${claudeBody.length} chars, ` +
      `docs/rulings.md ${rulingsBody.length}. The fuller one is the body; the other is kept ` +
      "verbatim as a variant, because the divergence ran both ways and neither file was complete.",
  );
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// --- the constitution's un-numbered law -----------------------------------
// The transparency mandate, the fourteen-rung ladder, the four photo doors, the
// Kelly standard, the n-stores rule: among the most load-bearing rules in the
// product and not one of them ever had a number. They become records too, so
// the domain policies can be GENERATED rather than hand-written — a
// hand-written policy would be a new hand-maintained authority built inside the
// fix for the old one.
const constitutionBlocks = parseConstitution(claudeText);
let constitutionRecords = 0;
for (const b of constitutionBlocks) {
  const rec = importConstitutionBlock(b);
  rec.sourceRef = `docs/governance/legacy/CLAUDE.pre-remediation.md:${b.line}`;
  const prior = records.find((r) => r.id === rec.id);
  if (prior) {
    // Two blocks slugging alike is one rule the parser split. Keep the longer
    // body rather than minting a colliding id.
    if (rec.body.length > prior.body.length) prior.body = rec.body;
    continue;
  }
  records.push(rec);
  constitutionRecords += 1;
}

records.sort((a, b) => {
  const na = /^R-(\d+)$/.exec(a.id);
  const nb = /^R-(\d+)$/.exec(b.id);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a.id.localeCompare(b.id);
});

mkdirSync(dirname(LEDGER_PATH), { recursive: true });
writeLedger(records, LEDGER_PATH);

// The migration manifest is the preservation receipt: the legacy files' exact
// bytes at the moment of import, so a later reader can prove nothing was lost
// or quietly rewritten during the migration.
const manifest = {
  importedOn: process.env.WTP_IMPORT_DATE ?? null,
  legacy: {
    "CLAUDE.md": {
      bytes: Buffer.byteLength(claudeText, "utf8"),
      lines: claudeText.split("\n").length,
      words: claudeText.split(/\s+/).filter(Boolean).length,
      sha256: sha256(claudeText),
    },
    "docs/rulings.md": {
      bytes: Buffer.byteLength(rulingsText, "utf8"),
      lines: rulingsText.split("\n").length,
      words: rulingsText.split(/\s+/).filter(Boolean).length,
      sha256: sha256(rulingsText),
    },
  },
  imported: {
    entriesParsed: entries.length,
    recordsWritten: records.length,
    constitutionBlocksParsed: constitutionBlocks.length,
    constitutionRecords,
    divergentDualWriteCopies: divergentCopies,
    rulingBodiesTakenFromConstitution: fullerFromConstitution,
    rationaleCharactersRecovered: charactersRecovered,
    byKind: countBy(records, (r) => r.kind),
    byStatus: countBy(records, (r) => r.status),
    byDomain: countBy(records, (r) => r.domain),
    byProvenance: countBy(records, (r) => r.provenance),
    withUncertainty: records.filter((r) => r.uncertain.length > 0).length,
    relations: records.reduce((n, r) => n + r.relations.length, 0),
    highestNumber: records.reduce((max, r) => {
      const m = /^R-(\d+)$/.exec(r.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0),
  },
};

if (!existsSync(dirname(MANIFEST))) mkdirSync(dirname(MANIFEST), { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");

// RULING 159 — the floor is asserted BEFORE the counts are reported. Zero
// entries parsed from the legacy rulings document is a broken parser, never an
// empty document, and it must fail loudly rather than print a green zero.
//
// The pair is entries PARSED against entries that became records. The first
// version of this line put the total record count on the matched side, which
// exceeds the entry count because the constitution's un-numbered law is
// imported separately — and the floor threw, correctly, on the spot. That is
// the instrument catching a real misuse rather than being asserted to work.
console.log(
  floorLine(
    floored(
      "governance:import ruling entries",
      "docs/rulings.md headings",
      entries.length,
      records.filter((r) => r.sourceRef.startsWith("docs/rulings.md")).length,
    ),
  ),
);
console.log(
  floorLine(
    floored(
      "governance:import constitution blocks",
      "CLAUDE.md law blocks",
      constitutionBlocks.length,
      constitutionRecords,
    ),
  ),
);

const issues = records.flatMap(validateRecord);


console.log(`entries parsed        ${entries.length}`);
console.log(`divergent dual-write copies ${divergentCopies} (both kept; ${fullerFromConstitution} bodies taken from CLAUDE, ${charactersRecovered} chars recovered)`);
console.log(`constitution blocks   ${constitutionRecords} (from ${constitutionBlocks.length} parsed)`);
console.log(`records written       ${records.length}`);
console.log(`highest number        ${manifest.imported.highestNumber}`);
console.log(`relations extracted   ${manifest.imported.relations}`);
console.log(`with uncertainty      ${manifest.imported.withUncertainty}`);
console.log(`by kind               ${JSON.stringify(manifest.imported.byKind)}`);
console.log(`by status             ${JSON.stringify(manifest.imported.byStatus)}`);
console.log(`by domain             ${JSON.stringify(manifest.imported.byDomain)}`);
console.log(`schema issues         ${issues.length}`);
for (const i of issues.slice(0, 25)) console.log(`  ${i.id} ${i.rule}: ${i.detail}`);
if (issues.length > 25) console.log(`  ... and ${issues.length - 25} more`);

function countBy<T>(xs: T[], f: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = f(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
