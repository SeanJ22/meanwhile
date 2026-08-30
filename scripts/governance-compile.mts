/**
 * `pnpm governance:compile` — apply adoptions to the ledger and regenerate
 * every derived view.
 *
 * ## What is input and what is output
 *
 * INPUT is `docs/governance/ledger.jsonl` plus `lib/governance/adoptions.ts`.
 * Everything below is OUTPUT and is never hand-edited (RULING 92):
 *
 *   docs/governance/index.json            ids, aliases, relations, pointers
 *   docs/governance/current-decisions.md  ACTIVE non-law decisions, by question
 *   docs/governance/history.md            the human-readable historical view
 *   docs/rulings.md                       the compatibility view
 *
 * `docs/rulings.md` becoming generated is the point of the exercise. It stops
 * being a second hand-maintained authority the moment a person can no longer
 * edit it and have the edit survive.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLAIM_ASSIGNMENTS,
  CLAIM_RETIREMENTS,
  NEW_DECISIONS,
  REMEDIATION_DATE,
  STATUS_RESOLUTIONS,
} from "../lib/governance/adoptions.ts";
import { CLASSIFICATIONS } from "../lib/governance/classification.ts";
import { LEDGER_PATH, readLedger, writeLedger } from "../lib/governance/ledger.ts";
import {
  CURRENT_STATUSES,
  DOMAINS,
  canonicalId,
  type GovernanceRecord,
} from "../lib/governance/schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOV = join(ROOT, "docs", "governance");

const records = readLedger(LEDGER_PATH);
const byId = new Map(records.map((r) => [r.id, r]));

const applied = { claims: 0, statuses: 0, adopted: 0 };

// --- 1b. historical classification ------------------------------------------
// The 43 records the mechanical importer honestly could not type. Each is
// resolved from its OWN WORDS, with the supporting quote carried on the record
// — so a later reader can check the classification against the entry rather
// than taking this file's word for it.
let classified = 0;
for (const [id, c] of Object.entries(CLASSIFICATIONS)) {
  const r = byId.get(id);
  if (!r) throw new Error(`classification targets a record that does not exist: ${id}`);
  if (r.uncertain.length === 0) continue;
  r.kind = c.kind;
  r.provenance = c.provenance;
  // The uncertainty is RESOLVED, not deleted: what replaces it is the evidence
  // that resolved it, so the doubt and its answer travel together.
  r.uncertain = [];
  r.routingNotes.push(`classified ${c.kind}/${c.provenance} from the entry's own words: ${c.evidence}`);
  // STATUS FIRST, then the policy pointer. The other order looks equivalent and
  // is not: these records were parked HISTORICAL while unclassified, so a
  // pointer assigned before the promotion tested a status that had not moved
  // yet and 17 newly-current rules shipped with no operative home. The
  // `law-without-policy` check caught it.
  if (c.kind === "TOMBSTONE") {
    r.status = "RETIRED";
  } else if (c.kind === "FACT" || c.kind === "RATIFICATION" || c.kind === "ACCEPTANCE") {
    // A measurement, a confirmation and an approval are all history. None of
    // them is a current instruction, and typing them as one is the failure the
    // FACT-as-instruction check exists for.
    r.status = "HISTORICAL";
  } else if (r.status === "HISTORICAL") {
    r.status = "ACTIVE";
  }

  r.operativePolicy =
    c.kind === "LAW_DECISION" && CURRENT_STATUSES.includes(r.status)
      ? `docs/governance/policies/${r.domain}.md`
      : null;
  classified += 1;
}

// --- 2. claim assignments --------------------------------------------------
for (const a of CLAIM_ASSIGNMENTS) {
  const r = byId.get(a.id);
  if (!r) throw new Error(`claim assignment targets a record that does not exist: ${a.id}`);
  if (!r.claims.some((c) => c.key === a.key)) r.claims.push({ key: a.key, value: a.value });
  if (!r.routingNotes.some((n) => n.startsWith(`claim ${a.key}`))) {
    r.routingNotes.push(`claim ${a.key}=${a.value}: ${a.why}`);
  }
  applied.claims += 1;
}

// --- 3. new author decisions ----------------------------------------------
// An adopted number is immutable and is never reused (RULING 99, RULING 176),
// and that is enforced PER ID below rather than against a high-water mark. A
// high-water mark only catches a collision at the top of the sequence, and the
// collision this repository actually suffered on 2026-08-22 was in the middle:
// a brief adopted five rulings as 81 through 85 while 81 and 82 had already
// been spent earlier the same day.
const ADOPTION_SOURCE = "lib/governance/adoptions.ts";
for (const d of NEW_DECISIONS) {
  const id = canonicalId(d.n);
  const existing = byId.get(id);
  // Re-running the compiler must reproduce the same bytes rather than throw or
  // duplicate. A record this file already owns is REGENERATED in place; a
  // record owned by anything else is a genuine id collision, and an adopted
  // number is immutable (RULING 99, RULING 176).
  if (existing && existing.sourceRef !== ADOPTION_SOURCE) {
    throw new Error(
      `adoption ${d.n} collides with adopted id ${id} from ${existing.sourceRef}; adopted numbers are immutable`,
    );
  }
  if (existing) {
    const at = records.indexOf(existing);
    records.splice(at, 1);
  }
  const rec: GovernanceRecord = {
    id,
    aliases: [`RULING ${d.n}`, `R${d.n}`, `R-${d.n}`],
    kind: d.kind,
    status: "ACTIVE",
    provenance: d.provenance,
    domain: d.domain,
    title: d.title,
    // A later amendment carries its OWN date. Stamping every adoption with the
    // remediation date would misdate a rule to the day before it was made, and
    // every decision taken in between would appear to have been taken under it.
    adopted: d.adopted ?? REMEDIATION_DATE,
    body: d.body,
    variants: [],
    relations: d.relations ?? [],
    operativePolicy:
      d.kind === "LAW_DECISION" ? `docs/governance/policies/${d.domain}.md` : null,
    claims: d.claims ?? [],
    uncertain: [],
    routingNotes: ["adopted by the governance remediation brief of 2026-08-26"],
    sourceRef: ADOPTION_SOURCE,
  };
  records.push(rec);
  byId.set(id, rec);
  applied.adopted += 1;
}

// --- 3b. status resolutions ------------------------------------------------
// RUN AFTER ADOPTION, deliberately. A resolution names the record that took
// over, and the record that takes over is frequently adopted in the SAME
// compile — RULING 189 retiring RULING 187 is exactly that shape. Resolving
// first meant a new amendment could retire nothing until a second run, and the
// existence check below would fail on the first.
//
// It also fixes the precedence. Adoption regenerates the records this file
// owns, so a status applied before it would simply be overwritten back to
// ACTIVE. Supersession is the later word, and it must be the last one applied.
for (const res of STATUS_RESOLUTIONS) {
  const r = byId.get(res.id);
  if (!r) throw new Error(`status resolution targets a record that does not exist: ${res.id}`);
  if (!byId.has(res.by)) throw new Error(`resolution ${res.id} cites missing ${res.by}`);
  r.status = res.status;
  // A record whose operative force moved has no CURRENT home. Pointing it at a
  // policy would put retired text back in front of a session.
  if (!CURRENT_STATUSES.includes(r.status)) r.operativePolicy = null;
  if (!r.routingNotes.some((n) => n.startsWith("status resolved"))) {
    r.routingNotes.push(`status resolved to ${res.status} by ${res.by}: ${res.why}`);
  }
  applied.statuses += 1;
}

// --- 3c. claim retirements ---------------------------------------------------
// RUN AFTER ADOPTION AND RESOLUTION, for the same reason 3b runs after 3: the
// ruling that takes a slot over is frequently adopted in the same compile, and
// the existence check must be able to see it. A retirement removes ONLY the
// claim from the amended record — the semantic index stops carrying two answers
// for one question — while the record's body, status and history stay whole.
// `findClaimConflicts` counts AMENDED records as current, so an amendment that
// moves a slot MUST retire the old claim or report itself as a contradiction.
// The removal is recorded in the record's routing notes; nothing is silent.
for (const ret of CLAIM_RETIREMENTS) {
  const r = byId.get(ret.id);
  if (!r) throw new Error(`claim retirement targets a record that does not exist: ${ret.id}`);
  if (!byId.has(ret.by)) throw new Error(`claim retirement ${ret.id} cites missing ${ret.by}`);
  const before = r.claims.length;
  r.claims = r.claims.filter((c) => c.key !== ret.key);
  const note = `claim retired ${ret.key} -> ${ret.by}: ${ret.why}`;
  if (!r.routingNotes.some((n) => n.startsWith(`claim retired ${ret.key}`))) {
    r.routingNotes.push(note);
  }
  if (before !== r.claims.length) applied.claims += 1;
}


// The constitution's un-numbered law is NOT re-derived here. It was imported
// ONCE, from the pinned pre-remediation snapshot, by `pnpm governance:import`.
//
// **This was a real defect and it is recorded rather than smoothed.** The first
// version of this file re-derived those records from the LIVE `CLAUDE.md` on
// every compile. The moment the constitution was shortened — which is the whole
// point of the remediation — the transparency mandate, the fourteen-rung
// ladder, the four photo doors and the Kelly standard were deleted from the
// ledger, silently, by the tool built to preserve them. The
// duplicate-canonical-law check stayed green throughout, because deletion is
// not duplication.
//
// A generator that re-derives canonical state from a file that is ALLOWED TO
// CHANGE is not a generator; it is a mirror, and it loses everything the file
// stops saying. The ledger is canonical now. The snapshot is the input.
const constitutionImported = records.filter((r) =>
  r.sourceRef.startsWith("docs/governance/legacy/CLAUDE"),
).length;

records.sort(sortRecords);
writeLedger(records, LEDGER_PATH);

// --- 4. generated views ----------------------------------------------------
mkdirSync(GOV, { recursive: true });

const current = records.filter((r) => CURRENT_STATUSES.includes(r.status));
const law = current.filter((r) => r.kind === "LAW_DECISION");
const decisions = current.filter((r) => r.kind === "DECISION");
const historical = records.filter((r) => !CURRENT_STATUSES.includes(r.status));

// index.json — the machine index.
const index = {
  generatedBy: "pnpm governance:compile",
  neverHandEdit: true,
  snapshot: "",
  counts: {
    records: records.length,
    current: current.length,
    law: law.length,
    decisions: decisions.length,
    historical: historical.length,
  },
  records: records.map((r) => ({
    id: r.id,
    aliases: r.aliases,
    title: r.title,
    kind: r.kind,
    status: r.status,
    provenance: r.provenance,
    domain: r.domain,
    adopted: r.adopted,
    operativePolicy: r.operativePolicy,
    claims: r.claims,
    relations: r.relations,
    uncertain: r.uncertain,
    sourceRef: r.sourceRef,
  })),
};
const snapshot = createHash("sha256")
  .update(JSON.stringify(index.records), "utf8")
  .digest("hex")
  .slice(0, 16);
index.snapshot = snapshot;
writeFileSync(join(GOV, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");

// current-decisions.md — ACTIVE non-law decisions, organized BY DOMAIN rather
// than by date. A session asking "what governs now?" is asking a question about
// a subject, never about a week.
const cd: string[] = [
  "# Current decisions — active, not yet law",
  "",
  "**GENERATED by `pnpm governance:compile`. Never hand-edit (RULING 92).**",
  `Governance snapshot \`${snapshot}\`.`,
  "",
  "These are ACTIVE author decisions that have not become constitutional or",
  "domain law. Organized by domain, not by date: a session asking *what governs",
  "now?* is asking about a subject, never about a week.",
  "",
  "For law, read `CLAUDE.md` and `docs/governance/policies/`.",
  "For why a rule exists, read `docs/governance/history.md` — on demand, never at startup.",
  "",
];
for (const domain of [...new Set(decisions.map((d) => d.domain))].sort()) {
  cd.push(`## ${domain}`, "");
  for (const d of decisions.filter((x) => x.domain === domain).sort(sortRecords)) {
    cd.push(`### ${d.title}`, "", `*${d.adopted} · ${d.provenance} · \`${d.id}\`*`, "", d.body, "");
  }
}
if (decisions.length === 0) {
  cd.push(
    "_No active non-law decisions. Every binding record is either promoted law or",
    "historical._",
    "",
  );
}
writeFileSync(join(GOV, "current-decisions.md"), cd.join("\n"), "utf8");

// history.md — the full narrative, retrieved on demand.
const hist: string[] = [
  "# Governance history",
  "",
  "**GENERATED by `pnpm governance:compile`. Never hand-edit (RULING 92).**",
  `Governance snapshot \`${snapshot}\`. ${records.length} records.`,
  "",
  "This is the append-only historical record, rendered for reading. **It is not",
  "loaded as startup context** (RULING 186) — history explains current authority",
  "and never becomes it (RULING 172).",
  "",
  "The canonical store is `docs/governance/ledger.jsonl`. This file is a view of it.",
  "",
  "| id | title | kind | status | adopted |",
  "| --- | --- | --- | --- | --- |",
];
for (const r of records) {
  hist.push(
    `| \`${r.id}\` | ${escapePipes(r.title)} | ${r.kind} | ${r.status} | ${r.adopted ?? "—"} |`,
  );
}
hist.push("");
for (const r of records) {
  hist.push(`## ${r.title}`, "");
  hist.push(
    `*\`${r.id}\` · ${r.kind} · ${r.status} · ${r.provenance} · ${r.domain} · ${r.adopted ?? "no date"}*`,
    "",
  );
  if (r.aliases.length) hist.push(`Also cited as: ${r.aliases.map((a) => `\`${a}\``).join(", ")}.`, "");
  for (const rel of r.relations) {
    hist.push(`- **${rel.kind}** → \`${rel.target}\``);
    if (rel.changed) hist.push(`  - changed: ${rel.changed}`);
    if (rel.survives) hist.push(`  - survives: ${rel.survives}`);
  }
  if (r.relations.length) hist.push("");
  if (r.uncertain.length) {
    hist.push("**Uncertain:**", ...r.uncertain.map((u) => `- ${u}`), "");
  }
  hist.push(r.body, "", ...renderVariants(r));
}
writeFileSync(join(GOV, "history.md"), hist.join("\n"), "utf8");

// docs/rulings.md — the compatibility view. Generated from the same records so
// it can never disagree with the ledger again.
const rul: string[] = [
  "# Rulings — the compatibility view",
  "",
  "**GENERATED by `pnpm governance:compile`. Never hand-edit (RULING 92).**",
  `Governance snapshot \`${snapshot}\`.`,
  "",
  "**This file stopped being an authority on 2026-08-26.** It was a second",
  "hand-maintained record of decisions, written by hand in the same session that",
  "wrote them into `CLAUDE.md`, with nothing checking that the two copies agreed.",
  "That dual write is what let the constitution carry RULING 169 and RULING 170",
  "while this file stopped at 168.",
  "",
  "It is kept, and generated, so that every `RULING n` reference in this",
  "repository and in every past session report still resolves.",
  "",
  "- **The canonical store is `docs/governance/ledger.jsonl`.**",
  "- **Current law is `CLAUDE.md` and `docs/governance/policies/`.**",
  "- **Current non-law decisions are `docs/governance/current-decisions.md`.**",
  "- **Full rationale is `docs/governance/history.md`.**",
  "",
  "**Numbering is GLOBAL and IMMUTABLE** (RULING 176). The header this file",
  "carried until 2026-08-26 said numbering was per-brief and that two briefs",
  "could both have a RULING 7. That was already untrue when it was read: the",
  "sequence is unique from 1 through 171, and later collision handling treats",
  "these ids as permanent. An adopted number is never reused and never renumbered.",
  "",
  "---",
  "",
];
/*
 * THE `RULING n` SPACE HOLDS NUMBERED RULINGS AND NOTHING ELSE.
 *
 * This loop used to skip `R-X-*` and then assume everything remaining was
 * numeric, so all 24 `R-C-*` records — the constitution's un-numbered law —
 * rendered as `## RULING undefined`. That is worse than either alternative it
 * sat between: it neither preserved the un-numbered namespace nor minted a
 * number, it just produced a heading that resolves to nothing.
 *
 * Un-numbered records are NOT given numbers. They were never rulings, and
 * spending immutable ids on them is the collision the amendment procedure
 * exists to refuse. They are listed in their own section below, under their own
 * ids, pointing at the policy that carries them — so nothing is discarded and
 * nothing is silently promoted.
 */
const numbered = records.filter((r) => /^R-0*\d+$/.test(r.id));
const unnumbered = records.filter((r) => !/^R-0*\d+$/.test(r.id));

for (const r of numbered) {
  const n = /^R-0*(\d+)$/.exec(r.id)?.[1];
  rul.push(`## RULING ${n} — ${stripLeader(r.title)}`, "");
  rul.push(`*${r.kind} · ${r.status} · adopted ${r.adopted ?? "no date recorded"}*`, "");
  if (!CURRENT_STATUSES.includes(r.status)) {
    rul.push(`> **This is ${r.status}.** It is history. It explains; it does not govern.`, "");
  } else if (r.operativePolicy) {
    rul.push(`> Operative current text: \`${r.operativePolicy}\`.`, "");
  }
  for (const rel of r.relations) {
    rul.push(`- **${rel.kind}** → \`${rel.target}\``);
    if (rel.changed) rul.push(`  - what changed: ${rel.changed}`);
    if (rel.survives) rul.push(`  - what survives: ${rel.survives}`);
  }
  if (r.relations.length) rul.push("");
  rul.push(r.body, "", ...renderVariants(r));
}

/*
 * The un-numbered governance records, listed as what they are.
 *
 * `RULING n` is a compatibility surface: it exists so every `RULING 26` in this
 * repository still resolves. These records never had a number, so they cannot
 * appear there — but they are among the most load-bearing rules in the product
 * (the transparency mandate, the fourteen-rung ladder, the four photo doors),
 * and a compatibility view that simply dropped them would hide them from every
 * reader who comes here first.
 *
 * So they are named, with their canonical ids and where their operative text
 * lives. An INDEX, deliberately: the bodies are in the policies and in
 * `history.md`, and copying them here would rebuild the duplication this whole
 * migration removed.
 */
rul.push(
  "---",
  "",
  "## Un-numbered governance records",
  "",
  "**These were never rulings and carry no ruling number.** They are law and",
  "history that arrived without one — the constitution's own un-numbered rules",
  "(`R-C-*`) and the un-numbered entries of the legacy rulings document",
  "(`R-X-*`): acceptances, recorded measurements, reserved numbers.",
  "",
  "**No number is minted for them.** An adopted ruling number is immutable and",
  "is never spent on a record that never had one (RULING 99, RULING 176).",
  "",
  "This is an index. Operative text lives in the policy named on each row, and",
  "the full body is in `docs/governance/history.md`.",
  "",
  "| id | title | kind | status | operative text |",
  "| --- | --- | --- | --- | --- |",
);
for (const r of unnumbered) {
  rul.push(
    `| \`${r.id}\` | ${escapePipes(stripLeader(r.title))} | ${r.kind} | ${r.status} | ` +
      `${r.operativePolicy ? `\`${r.operativePolicy}\`` : "— (history)"} |`,
  );
}
rul.push("");

writeFileSync(join(ROOT, "docs", "rulings.md"), rul.join("\n"), "utf8");

// --- 5. domain policy modules ---------------------------------------------
// GENERATED from the ledger. A policy file is a VIEW of the current law for one
// domain, never a second copy somebody maintains — which is what makes "one
// canonical source per rule" checkable rather than aspirational.
const POLICY_DIR = join(GOV, "policies");
mkdirSync(POLICY_DIR, { recursive: true });
const policyCounts: Record<string, number> = {};
for (const domain of DOMAINS) {
  const mine = law.filter((r) => r.domain === domain).sort(sortRecords);
  policyCounts[domain] = mine.length;
  const out: string[] = [
    `# Current law — ${domain}`,
    "",
    "**GENERATED by `pnpm governance:compile`. Never hand-edit (RULING 92).**",
    `Governance snapshot \`${snapshot}\`. ${mine.length} rule(s) in force.`,
    "",
    "This file carries CURRENT law for this domain and nothing else. Superseded",
    "wording is not here — it is in `docs/governance/history.md`, which explains",
    "and never governs (RULING 172).",
    "",
    "Authority precedence is RULING 185. The root constitution is `CLAUDE.md`.",
    "",
    "---",
    "",
  ];
  if (mine.length === 0) out.push("_No law currently files under this domain._", "");
  for (const r of mine) {
    out.push(`## ${r.title}`, "");
    const stamp = r.adopted ?? "date UNKNOWN — the source carried no stamp (RULING 107)";
    const cites = r.aliases.length
      ? ` · also cited as ${r.aliases.map((a) => "`" + a + "`").join(", ")}`
      : "";
    out.push(`*\`${r.id}\` · ${r.status} · ${r.provenance} · ${stamp}${cites}*`, "");
    for (const rel of r.relations) {
      out.push(`- **${rel.kind}** → \`${rel.target}\``);
      if (rel.changed) out.push(`  - what changed: ${rel.changed}`);
      if (rel.survives) out.push(`  - what survives, in force: ${rel.survives}`);
    }
    for (const c of r.claims) out.push(`- **sets** \`${c.key}\` = \`${c.value}\``);
    if (r.relations.length || r.claims.length) out.push("");
    out.push(r.body, "", ...renderVariants(r));
  }
  writeFileSync(join(POLICY_DIR, `${domain}.md`), out.join("\n"), "utf8");
}

// --- 6. the autonomous-system constitution ----------------------------------
// GENERATED. The view IS the body of the adopting record (RULING 219), verbatim
// plus a trailing newline — so the committed file byte-matches the adopted text
// by construction, and changing the constitution means adopting a later ruling
// that supersedes the current holder. Deliberately NOT assembled from pieces:
// a view stitched together here would make this script a second author of the
// constitution's wording, which is the dual write again. The holder is found by
// claim, not by hard-coded id, so a superseding ruling takes the view with it.
const constitutionHolder = records.find(
  (r) =>
    CURRENT_STATUSES.includes(r.status) &&
    r.claims.some(
      (c) => c.key === "governance.constitution_view" && c.value === "generated-view-of-the-ledger",
    ),
);
if (!constitutionHolder) {
  throw new Error(
    "no current record claims governance.constitution_view = generated-view-of-the-ledger; " +
      "the constitution view has no source and cannot be generated",
  );
}
writeFileSync(join(GOV, "constitution.md"), constitutionHolder.body + "\n", "utf8");

console.log(`historical classifications  ${classified}`);
console.log(`constitution blocks         ${constitutionImported}`);
console.log(`policy modules              ${DOMAINS.length}  ${JSON.stringify(policyCounts)}`);
console.log(`status resolutions applied  ${applied.statuses}`);
console.log(`claim assignments applied   ${applied.claims}`);
console.log(`new decisions adopted       ${applied.adopted}`);
console.log(`records total               ${records.length}`);
console.log(`current (ACTIVE|AMENDED)    ${current.length}`);
console.log(`  law                       ${law.length}`);
console.log(`  non-law decisions         ${decisions.length}`);
console.log(`historical                  ${historical.length}`);
console.log(`governance snapshot         ${snapshot}`);


/**
 * Render a record's preserved SECOND hand-written copy.
 *
 * 87 of 90 rulings had two copies that diverged, in both directions. Rendering
 * only the fuller one would leave several hundred of the author's own sentences
 * committed to the ledger and invisible in every view a person reads — which is
 * preservation in the technical sense and loss in every sense that matters.
 */
function renderVariants(r: GovernanceRecord): string[] {
  if (!r.variants || r.variants.length === 0) return [];
  const out: string[] = [];
  for (const v of r.variants) {
    out.push(
      "<details>",
      `<summary>The other hand-written copy of this rule, from <code>${v.source}</code> — preserved verbatim</summary>`,
      "",
      "*Two copies of this rule were maintained by hand and they diverged. Neither was complete.",
      "The fuller one is above; this is the other, kept whole rather than merged, because merging",
      "prose neither author wrote would be composition.*",
      "",
      v.body,
      "",
      "</details>",
      "",
    );
  }
  return out;
}

function sortRecords(a: GovernanceRecord, b: GovernanceRecord): number {
  const na = /^R-(\d+)$/.exec(a.id);
  const nb = /^R-(\d+)$/.exec(b.id);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a.id.localeCompare(b.id);
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function stripLeader(title: string): string {
  return title.replace(/^RULING\s+\d+\s*[—–-]\s*/i, "");
}
