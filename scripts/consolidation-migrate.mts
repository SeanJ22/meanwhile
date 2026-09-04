/**
 * `pnpm exec tsx scripts/consolidation-migrate.mts` — the one-time 2026-09-03
 * consolidation migration. Reads the PRISTINE delivered candidate ledger and
 * writes the final canonical `docs/governance/ledger.jsonl`.
 *
 * **COMPLETED. This is a historical record of the transform, not a live tool.**
 * Its input — the delivered bundle at `docs/governance-consolidation-2026-09-03/`
 * — was removed after the migration landed; its files are recorded by SHA-256 in
 * `docs/governance/consolidation-input-manifest-2026-09-03.json`. The script is
 * kept so every edit the landing session made to the delivered corpus is
 * auditable in one place; it will not run again without the bundle restored.
 *
 * It applies, in order: §1B canonical classification fixes, the SUPERSEDED
 * lineage repairs, the RULING 247 `ruleKey` backfill, the §6 contradiction
 * body edits, and the conservation hole repairs. Every edit is asserted to hit
 * an existing record and to actually change the bytes it claims to; a no-op
 * edit is a defect, not a success.
 */
import { readLedger, writeLedger, LEDGER_PATH } from "../lib/governance/ledger.ts";
import { CURRENT_STATUSES, type GovernanceRecord, type Relation } from "../lib/governance/schema.ts";

const CAND = "docs/governance-consolidation-2026-09-03/ledger.jsonl";
const records = readLedger(CAND);
const byId = new Map(records.map((r) => [r.id, r]));
const log: string[] = [];

function rec(id: string): GovernanceRecord {
  const r = byId.get(id);
  if (!r) throw new Error(`migration targets a record that does not exist: ${id}`);
  return r;
}
function note(r: GovernanceRecord, n: string) {
  if (!r.routingNotes.some((x) => x === n)) r.routingNotes.push(n);
}
function addRelation(fromId: string, rel: Relation) {
  const r = rec(fromId);
  if (r.relations.some((x) => x.kind === rel.kind && x.target === rel.target)) return;
  r.relations.push(rel);
  log.push(`relation ${fromId} ${rel.kind} -> ${rel.target}`);
}
function editBody(id: string, find: string, replace: string) {
  const r = rec(id);
  if (!r.body.includes(find)) throw new Error(`editBody(${id}): find-string absent, no-op would be silent:\n${find}`);
  r.body = r.body.split(find).join(replace);
  log.push(`body ${id}: replaced ${JSON.stringify(find.slice(0, 40))}...`);
}
// Append a bullet as the last clause, before the trailing "---" separator when
// present. Restores a conserved-elsewhere clause into the policy that OWNS it.
function appendBullet(id: string, bullet: string) {
  const r = rec(id);
  const add = `\n- ${bullet}`;
  const m = r.body.match(/\n\n---\s*$/);
  if (m) {
    const at = r.body.length - m[0].length;
    r.body = r.body.slice(0, at) + add + r.body.slice(at);
  } else {
    r.body = `${r.body.replace(/\s*$/, "")}${add}`;
  }
  log.push(`append ${id}: ${bullet.slice(0, 45)}...`);
}

// ============================ §1B classification ============================
// R-0123 / R-0151 — batches of one-day DECISIONS mis-typed LAW_DECISION. Their
// own bodies say so. Reclassify to DECISION so they file under current-decisions
// canonically, and clear the operativePolicy pointer a decision may not carry.
for (const id of ["R-0123", "R-0151"]) {
  const r = rec(id);
  r.kind = "DECISION";
  r.operativePolicy = null;
  note(r, "reclassified LAW_DECISION -> DECISION by the 2026-09-03 consolidation: the body is a batch of dated author calls, not a promoted rule (§1B)");
  log.push(`reclassify ${id} -> DECISION`);
}

// R-0019 — an active deferral of the committee-sale section that RULING 261 now
// closes. R-0261 supersedes it; R-0019 leaves current.
addRelation("R-0261", { kind: "supersedes_full", target: "R-0019" });
{
  const r = rec("R-0019");
  r.status = "SUPERSEDED";
  r.operativePolicy = null;
  note(r, "status resolved to SUPERSEDED by R-0261: the deferred committee-sale question is decided (§1B, §6 current-decisions)");
  log.push("supersede R-0019 by R-0261");
}

// R-0234 — a one-time model-switch override whose reversibility clause fired the
// same day (measured by R-0236: the constant is back on claude-opus-5). Spent,
// not current authority. Move it out via the lifecycle; the standing rule is
// R-0230, which stays law.
{
  const r = rec("R-0234");
  r.status = "HISTORICAL";
  r.operativePolicy = null;
  note(r, "status resolved to HISTORICAL by the 2026-09-03 consolidation: the one-time override's reversibility clause fired the same day (R-0236); the standing verdict rule is R-0230 (§1B)");
  log.push("historicize R-0234 (spent one-time override)");
}

// R-0235, R-0236, R-0239, R-0246 — dated FACT measurements left ACTIVE. A
// measurement is history, never a current instruction.
for (const id of ["R-0235", "R-0236", "R-0239", "R-0246"]) {
  const r = rec(id);
  r.status = "HISTORICAL";
  r.operativePolicy = null;
  note(r, "status resolved to HISTORICAL by the 2026-09-03 consolidation: a dated FACT measurement is history, not current binding authority (§1B)");
  log.push(`historicize FACT ${id}`);
}

// ======================= SUPERSEDED lineage repairs =========================
// R-0007, R-0018, R-0022 are SUPERSEDED with no incoming successor edge. Their
// own bodies record that RULING 26 (Prompt D) superseded them in full on
// 2026-08-20. Record that lineage so no superseded record is an orphan (§6
// numbering: every SUPERSEDED record has a relation path).
for (const target of ["R-0007", "R-0018", "R-0022"]) {
  addRelation("R-0026", { kind: "supersedes_full", target });
  note(rec(target), "superseded in full by R-0026 (2026-08-20); lineage edge recorded by the 2026-09-03 consolidation (§6)");
}

// ============================ ruleKey backfill ==============================
// RULING 247: every CURRENT LAW_DECISION holds exactly one stable rule slot.
// Keys are domain-scoped and survive supersession. Assigned by hand once, here,
// because they are authored identifiers, not derivable from the title.
const RULEKEYS: Record<string, string> = {
  "R-0230": "meta-governance.model-switch-verdict",
  "R-0247": "meta-governance.law-written-once",
  "R-0248": "discovery.acquisition-doctrine",
  "R-0249": "discovery.retrieval-ladder",
  "R-0250": "discovery.absence-argued",
  "R-0251": "discovery.coverage-counted",
  "R-0252": "discovery.method-knowledge",
  "R-0253": "discovery.hunt-conduct",
  "R-0254": "rendering-neutrality.show-everything",
  "R-0255": "rendering-neutrality.symmetric-effort",
  "R-0256": "rendering-neutrality.scope-identity-fields",
  "R-0257": "rendering-neutrality.fix-proved-on-reader-path",
  "R-0258": "rendering-neutrality.plain-language",
  "R-0259": "data-privacy.collection-boundary",
  "R-0260": "data-privacy.speak-your-mind",
  "R-0261": "business.what-is-sold",
  "R-0262": "visual-feedback.captures-and-spec-images",
  "R-0263": "sources-licensing.register-and-fetch",
  "R-0264": "sources-licensing.evidence-identity",
  "R-0265": "sources-licensing.secrets-and-owner-identity",
  "R-0266": "shipping-ci.verify-and-ship-once",
  "R-0267": "shipping-ci.a-gate-is-real",
  "R-0268": "shipping-ci.nightly-door",
  "R-0269": "shipping-ci.operation-returns-nothing",
  "R-0270": "tracker-workflow.queue-empties",
  "R-0271": "tracker-workflow.needs-sean",
  "R-0272": "meta-governance.how-law-is-made",
  "R-0273": "meta-governance.how-a-session-runs",
  "R-0274": "meta-governance.instrument-proves-its-claim",
  "R-0275": "meta-governance.data-conventions",
  "R-0276": "meta-governance.pilot-zips-and-order",
  "R-0277": "shipping-ci.integration-vs-activation",
};
let keyed = 0;
for (const r of records) {
  if (r.kind === "LAW_DECISION" && CURRENT_STATUSES.includes(r.status)) {
    const key = RULEKEYS[r.id];
    if (!key) throw new Error(`active LAW_DECISION ${r.id} has no ruleKey assignment — the backfill table is stale`);
    r.ruleKey = key;
    keyed += 1;
  }
}
for (const id of Object.keys(RULEKEYS)) {
  const r = byId.get(id);
  if (!r || r.kind !== "LAW_DECISION" || !CURRENT_STATUSES.includes(r.status)) {
    throw new Error(`ruleKey assigned to ${id} but it is not a current LAW_DECISION — table drift`);
  }
}
log.push(`ruleKey backfill: ${keyed} current LAW_DECISION keyed`);

// ============================ §6 body edits =================================
// Each replaces the contradictory wording; do not preserve the old text (§6).

// (1) History never overrides. R-0247 said older text in history governs the
// reading; that inverts the authority model. History explains, never governs.
editBody(
  "R-0247",
  "Where a reader believes it does, the older text in history governs the reading and the discrepancy is reported as a defect in this ruling, corrected by amendment.",
  "Where a reader believes it does, that belief is treated as a conservation failure, not a reading: the consolidated criterion is NOT MET until the missing clause is restored to the policy through the ledger or the current rule is amended. Base authority governs until the restoration lands. History explains a rule; it never overrides the current one.",
);

// (11) One permission enum everywhere.
editBody(
  "R-0263",
  "refuses any host recorded `no` or `unknown`",
  "refuses any host recorded `DISALLOWED` or `CANNOT_TELL` (the four permission states are `ALLOWED | DISALLOWED | CANNOT_TELL | NOT_APPLICABLE`, and the fetcher and the register name the same states)",
);

// (3) One owner-terminal state: NEEDS_SEAN. NEEDS_OWNER is removed from law.
editBody(
  "R-0273",
  "`NEEDS_OWNER` is terminal for the session's denominator",
  "`NEEDS_SEAN` is terminal for the session's denominator",
);

// (13) Depth-order scope: NH -> NJ -> AZ governs only the four-pilot sweep.
editBody(
  "R-0276",
  "Pilot membership changes only by author decision.",
  "Pilot membership changes only by author decision. The depth order above governs only this commissioned four-pilot sweep; it orders no unrelated future session and sets no frontier sequence — the frontier is unordered.",
);

// (7) walk:all scope reconciled with the Efficiency Law.
editBody(
  "R-0266",
  "`walk:all` runs against a local build, and every session ends by running it; a prior win that fails is a named regression",
  "`walk:all` runs against a local build, and every session that changed code, generated current authority, or state the walk depends on ends by running it at the exact integrated head; a prior win that fails is a named regression",
);

// (8) Deploy scope: staging renders the gate; production still verifies DONE.
editBody(
  "R-0266",
  "the freeze gate clear. Civic data is runtime and is not staged",
  "the freeze gate clear. The staging render satisfies the gate; it is never recorded as the production verification, and a reader-facing DONE still names the production deploy. Civic data is runtime and is not staged",
);
// (6) Rendering/suppression — one taxonomy. The absolute "no suppression path"
// contradicts the identity/safety/neutrality controls that legitimately hold
// the smallest affected fact (the photo gate withholds an unreviewed image).
// Scope it to collection-completeness suppression and name the carve-out.
editBody(
  "R-0254",
  "**No suppression path may exist in the codebase** — not live, not flagged, not disabled, not commented out. A guard test fails the build if one returns. The hunt-state field (`FOUND` / `NOT_HUNTED` / `VERIFIED_ABSENT` / `NOT_APPLICABLE`) is a work queue, never a gate, and never reaches a reader.",
  "**No COLLECTION-COMPLETENESS suppression path may exist in the codebase** — nothing may hide a candidate, contest, body, meeting or field because the hunt is incomplete or because something else is missing, whether live, flagged, disabled or commented out, and a guard test fails the build if one returns. This is not a bar on identity, provenance, legal, safety, neutrality or unresolved-contradiction controls, which may hold only the smallest affected fact, its inseparable comparison pair, or the single record — never unrelated verified truth: an unreviewed image renders nothing while its card renders in full. The hunt-state field is the disambiguator and never reaches a reader — `NOT_APPLICABLE` renders nothing, `NOT_HUNTED` renders its named gap, `VERIFIED_ABSENT` renders a source-backed field-specific fact, `FOUND` renders the value — and it is a work queue, never a gate.",
)
// Annotate the election-day future date so the doc-dates gate reads it as an
// expected future date, not a fabricated one (the twin in R-0215 is annotated).
editBody(
  "R-0261",
  "automatic publishing is deferred past 2026-11-03 (RULING 215, decision).",
  "automatic publishing is deferred past 2026-11-03 (RULING 215, decision). <!-- expected-future: 2026-11-03 general election day; verified against lib/ballot/election-dates.ts. -->",
);
// __BODY_EDITS__

// ============================ hole repairs ==================================
// Conservation holes proven by the clause-by-clause audit. Each restores a
// distinct current obligation the consolidation dropped, into the successor
// ruling that owns it. Sources: docs/governance/consolidation-map-2026-09-03.json.

// LADDER (restores R-C-ladder, R-0016, R-0166): the fourteen numbered
// retrieval-MECHANICS rungs and their meanings — a different ladder from the
// A0/A/B/C SOURCE tiers, and the numbering `walledAtRung` stores. The old body
// only POINTED at CLAUDE.md, which no longer carries them; make R-0249 the
// canonical holder and do not renumber.
editBody(
  "R-0249",
  "**The retrieval-mechanics ladder in `CLAUDE.md` is canonical and its numbering is what reaches the database as `walledAtRung`.** Only a genuinely new retrieval class adds a rung.",
  "**The retrieval-mechanics ladder is canonical HERE, and its numbering is what reaches the database as `walledAtRung`. There are FOURTEEN numbered rungs, walked in order; a bulk file is rung ZERO because a published file has no wall to get past.** The A0/A/B/C tiers above say WHERE to look; these rungs say HOW to get bytes past a wall, and only a genuinely new retrieval class adds one — the numbers are stable, because a stored `walledAtRung` would otherwise be reinterpreted: (1) committed snapshot; (2) plain fetch; (3) fetch with the full browser header set; (4) a different CLIENT whose TLS fingerprint passes; (5) a different EGRESS — a rung is `(client, headers, URL, egress)`, and a refused CI-runner IP is an egress wall; (6) the LIVE BROWSER with JavaScript executed and content awaited — a plain fetch returning nothing on a JS-rendered page is a FALSE MISS, not a wall; (7) the page's own network calls — the JSON endpoint feeding the widget; (8) structured markup the prose hides — vCard, JSON-LD, microdata, RSS, iCal; (9) linked documents in EVERY format — PDFs ARE DATA, text-layer first, OCR when scanned; (10) sitemaps, search-index caches, directory listings; (11) the Internet Archive, with snapshot URLs; (12) the vendor platform underneath — Diligent/BoardDocs, Granicus, CivicPlus and siblings; (13) the body's own public-records request path, as a named rung; (14) the author's browser, last.",
);

// R-0169 -> R-0251 (coverage): a broken walk's zero is a JOB failure.
editBody(
  "R-0251",
  "**A sovereign tribal nation is its own category of government** — neither federal, state nor local — with its own label and body class, nationally.",
  "**A sovereign tribal nation is its own category of government** — neither federal, state nor local — with its own label and body class, nationally.\n- **Zero at a tier fails loudly.** A zero where the walk should have returned something — zero counties in a US state, an empty official enumeration — is a BROKEN WALK and a JOB failure, never a coverage finding; a count is trusted only once the walk that produced it is proven to have run.",
);

// R-0198 -> R-0252 (method): a contract may only tighten what closes an obligation.
editBody(
  "R-0252",
  "The model's statements about those facts are recorded as claims and never become durable provenance.",
  "The model's statements about those facts are recorded as claims and never become durable provenance.\n- **A contract may only ever TIGHTEN what closes an obligation.** Naming an open disposition in an acceptable-dispositions list never makes it terminal — the evaluator still refuses it as outstanding — so a clause that would let a still-open civic obligation read as closed is refused.",
);

// R-0088 -> R-0253 (hunt conduct): record the literal query, not a description;
// and a zero-yield route is a reported success (the invention is the deliverable).
editBody(
  "R-0253",
  "**`docs/report-contract.md` is the close-out contract every hunt answers.** A brief may add to it and never subtract.",
  "**`docs/report-contract.md` is the close-out contract every hunt answers.** A brief may add to it and never subtract.\n- **Every expansion route records the LITERAL query or URL that produced it** — the exact text typed, not a description of the search — alongside how it was conceived, what it returned, where else it applies, and whether it was recorded.\n- **A zero-yield route is a reported success, never a defect. The invention is the deliverable, not the yield.** The route found and recorded is the result, whatever it returned; an empty expansion section fails the item.",
);

// R-0055 -> R-0255 (photo review): one tracker row per session, never per photo.
editBody(
  "R-0255",
  "and only an author-reviewed image renders; a review decision is about an image, never about a person, and a pending photo never withholds the card.",
  "and only an author-reviewed image renders; a review decision is about an image, never about a person, and a pending photo never withholds the card. Photo review is tracked one row per session listing the N photos decided, never one row per photo — a per-photo row would flood the queue with dozens of rows a session.",
);

// (R-0189's "merge cadence is not session cadence" and "resumability is not
// permission to stop" were flagged LOST by a packet-scoped auditor but the
// whole-corpus adjudication found them CONSERVED — merge-cadence verbatim in
// R-0266, resumability in R-0273's keep-working-while-authorized clause — so no
// restoration is made here; a second copy would be the dual write again.)

// R-0193 -> R-0274 (an instrument proves its claim): a count is not a set.
editBody(
  "R-0274",
  "and the auditor is itself scored by the control set: its catch rate on planted defects is reported beside its findings.",
  "and the auditor is itself scored by the control set: its catch rate on planted defects is reported beside its findings.\n- **A denominator is not a membership proof.** Cardinality is a diagnostic, not an identity: two sets of equal size are not the same set, and a gate that cannot NAME the elements it compared has not compared them.",
);
// --- GAP restorations from the whole-corpus adjudication of the 144 UNCERTAIN.
// Each is a distinct obligation the first audit flagged and the adjudication
// confirmed is carried NOWHERE. Restored into the ruling that owns it.

// R-0145 -> R-0255: social-media images are never a portrait source.
appendBullet("R-0255", "Social-media images are never a portrait source at any of the four photo doors — a candidate's self-published social image does not become a usable portrait, and a compliant route that fills the campaign-site field is not thereby a photo door.");

// R-0222 -> R-0256: an undetermined overlapping body stays; dropping it lies.
appendBullet("R-0256", "After an address narrows scope, an overlapping body whose governance of the reader has been determined to be nothing — neither confirmed nor excluded — stays exactly as it was; dropping it manufactures a false claim that it does not govern the reader.");

// R-0263 advocacy sources + attribution-ships-with-data.
appendBullet("R-0263", "Advocacy organizations, PACs and endorsement sites are never added as sources; the underlying government filing is the source of record for a candidate's positions and finances.");
appendBullet("R-0263", "Where a source's licence requires attribution (e.g. LegiScan CC BY 4.0), the attribution ships with the data it describes, wherever that data renders.");

// R-0127 / R-0238 -> R-0265: rotation remediation + the six-field report gate.
appendBullet("R-0265", "A leaked credential is remediated by rotation, never by scrubbing alone: any value written to a synced folder is assumed already read, and the compromised value is rotated dead and the new one proven live by calling both.");
appendBullet("R-0265", "Every credential creation, rotation or scope change is reported by name, provider, context, scope, actor and owner-copy location; a report missing any of the six fails the session report gate.");

// R-0052 / R-0061 -> R-0250: branch independence is counted over dependencies.
appendBullet("R-0250", "Branch independence is counted over distinct dependencies, never branch names: two routes that fail for the same reason are one route wearing two names, and an absence argued from them is void.");

// R-0057 -> R-0251: the state registers, and disagreement is a finding.
appendBullet("R-0251", "Coverage of the smallest bodies is also measured against the state registers that enumerate the twigs the Census of Governments and NCES miss.");
appendBullet("R-0251", "Two official enumerations that disagree is a finding, not an error: the body is named with both facts recorded, never dropped because two authorities could not agree it exists.");

// R-0041 -> R-0270: a session may not reword or retitle an author-written row.
appendBullet("R-0270", "A session may not reword, retitle or delete an author-written tracker row; it may work it, set a priority if none is set, and resolve it — the row's description is the author's.");

// R-0048 -> R-0273: section edits to state.md insert, never replace.
appendBullet("R-0273", "Section edits to `docs/state.md` insert; they never replace, so previously recorded state is never overwritten.");

// R-0190 -> R-0273: a tracker row is not work completion (surfaced by the
// acquisition-doctrine guard; a blocked route tempts a session into writing a
// row INSTEAD of working another route).
appendBullet("R-0273", "A tracker row is a record of work, never a substitute for it: if an item is executable now, it is executed now, not filed for later, and a created row is never reported as work completion.");

// R-C non-negotiables -> R-0254: an absence never wears a present value's styling.
appendBullet("R-0254", "A named gap renders in the gap's own visual register, never in a present value's styling — colour and style are claims too, so an absence may not wear a recorded value's appearance.");

// --- named principles the consolidation dropped, surfaced by the standing
// governance guards (their obligations were adjudicated CONSERVED-in-substance,
// but the distinct named bar was carried nowhere; restored to its home).

// R-0170 / R-0184 -> R-0250: "I have run out of ideas", and blocked != absent.
appendBullet("R-0250", "A session with no further avenue says \"I have run out of ideas\" — a claim about the session, never \"this is not published\", which is a claim about a government. A blocked route may never become a blocked fact: a CAPTCHA, a wall or missing tooling is a real transport state, never an absence.");

// R-0178 -> R-0251: the eligibility bound that keeps discovery finite.
appendBullet("R-0251", "A government page does not recursively make every hyperlink on the internet owed: a discovered route enlarges the active graph only when it plausibly advances an owed question — a body, an official, a meeting, an election, a filing, a record, or a new source class.");

// R-0178 -> R-0252: "nothing new learned" is measured, never inferred.
appendBullet("R-0252", "\"Nothing new learned\" is a legitimate measured result only after genuine expansion work occurred; it may never be inferred merely because every inherited route completed.");

// R-C / R-0178 -> R-0252: no manifest or taxonomy is ever complete.
appendBullet("R-0252", "No manifest, route list, source taxonomy, government-type or platform taxonomy is ever complete: each represents what the project knows now, and a new route is project knowledge, persisted, classified by portability and inherited by every later jurisdiction.");

// R-0189 -> R-0273: resumability is not permission to stop.
appendBullet("R-0273", "Persisted resumability is not permission to stop voluntarily: canonical resumable state exists so an interrupted session can resume, not so this one may end.");
// __HOLE_REPAIRS__

records.sort((a, b) => {
  const na = /^R-(\d+)$/.exec(a.id);
  const nb = /^R-(\d+)$/.exec(b.id);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a.id.localeCompare(b.id);
});
writeLedger(records, LEDGER_PATH);

console.log(log.join("\n"));
console.log(`\nwrote ${LEDGER_PATH} — run \`pnpm governance:check\` to verify the corpus`);
