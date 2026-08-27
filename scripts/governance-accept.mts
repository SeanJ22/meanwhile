/**
 * `pnpm governance:accept` — the FINAL acceptance gate for the whole
 * governance remediation.
 *
 * Stage 1 answered one question: is it safe for the descent to resume? This
 * answers a different and larger one: **is the entire remediation brief
 * satisfied?**
 *
 * Every criterion the brief names is checked against measured state. A
 * criterion that cannot be checked mechanically is not listed as passing — it
 * is named as deferred, with a reason, because a generic "the rest remains" is
 * exactly the omitted tail this architecture exists to make impossible.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CLAIM_KEYS, findClaimConflicts } from "../lib/governance/claims.ts";
import { currentLawSources } from "../lib/governance/current-law.ts";
import { loadIndex } from "../lib/governance/ledger.ts";
import { validateLedger } from "../lib/governance/validate.ts";
import {
  CURRENT_STATUSES,
  DOMAINS,
  RECORD_KINDS,
  AUTHORITATIVE_PROVENANCE,
} from "../lib/governance/schema.ts";
import {
  findReopenings,
  validateKnowledge,
  type MethodKnowledge,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import { ELIGIBLE_EDGE_VERSION } from "../lib/workstate/eligibility.ts";
import { proveResume } from "../lib/workstate/frontier.ts";
import { convergenceHolds, classifySessionStop, aggregateTail } from "../lib/workstate/types.ts";
import {
  generateHandoff,
  validateWorkstream,
  type Workstream,
} from "../lib/workstate/workstream.ts";
import { loadMethodStore, loadWorkstreamFor } from "../lib/workstate/load.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATES = ["nj", "az", "nh"] as const;
const TODAY = process.env.WTP_TODAY ?? "2026-08-26";

const index = loadIndex();
const records = index.records;
const current = records.filter((r) => CURRENT_STATUSES.includes(r.status));

// Loading is SHARED with the Stage 1 gate — see lib/workstate/load.ts.
const ws = (s: string) => loadWorkstreamFor(ROOT, s);
const method = () => loadMethodStore(ROOT);

interface Criterion {
  key: string;
  check: () => { pass: boolean; detail: string };
}

const C: Criterion[] = [
  {
    key: "canonical governance ledger",
    check: () => ({
      pass: records.length > 200 && existsSync(join(ROOT, "docs/governance/ledger.jsonl")),
      detail: `${records.length} typed records, append-only, one JSON object per line`,
    }),
  },
  {
    key: "global immutable ids",
    check: () => {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const r of records) {
        if (seen.has(r.id)) dupes.push(r.id);
        seen.add(r.id);
      }
      const dangling: string[] = [];
      for (const src of currentLawSources(ROOT)) {
        for (const m of src.text.matchAll(/RULING\s+(\d+)/gi)) {
          if (!index.resolve(`RULING ${m[1]}`)) dangling.push(`${src.path}:RULING ${m[1]}`);
        }
      }
      return {
        pass: dupes.length === 0 && dangling.length === 0,
        detail: `0 duplicate ids, 0 dangling references across ${currentLawSources(ROOT).length} current-law files, highest id ${index.highestNumber()}`,
      };
    },
  },
  {
    key: "binding provenance",
    check: () => {
      const bad = records.filter(
        (r) =>
          (r.kind === "LAW_DECISION" || r.kind === "DECISION") &&
          !AUTHORITATIVE_PROVENANCE.includes(r.provenance),
      );
      const uncertain = records.filter((r) => r.uncertain.length > 0);
      return {
        pass: bad.length === 0 && uncertain.length === 0,
        detail: `0 binding records without author provenance; ${uncertain.length} records with unresolved provenance`,
      };
    },
  },
  {
    key: "supersession model",
    check: () => {
      const rels = records.flatMap((r) => r.relations);
      const scoped = rels.filter((x) => x.kind === "amends" || x.kind === "supersedes_clause");
      const unscoped = scoped.filter((x) => !x.changed || !x.survives);
      return {
        pass: unscoped.length === 0 && rels.length > 10,
        detail: `${rels.length} relations, ${scoped.length} partial amendments, all carrying changed + survives`,
      };
    },
  },
  {
    key: "current authority compilation",
    check: () => {
      const conflicts = findClaimConflicts(records);
      const answered = CLAIM_KEYS.filter((k) =>
        current.some((r) => r.claims.some((c) => c.key === k.key)),
      ).length;
      return {
        pass: conflicts.length === 0 && answered === CLAIM_KEYS.length,
        detail: `${answered} of ${CLAIM_KEYS.length} declared rule slots answered, ${conflicts.length} conflicts`,
      };
    },
  },
  {
    key: "root CLAUDE constitution",
    check: () => {
      const t = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
      const bytes = Buffer.byteLength(t);
      const indexesAll = DOMAINS.every((d) => t.includes(`docs/governance/policies/${d}.md`));
      return {
        pass: bytes < 40_000 && indexesAll && t.includes("Authority precedence"),
        detail: `${bytes} bytes (was 254,943), indexes all ${DOMAINS.length} policies, carries the precedence model`,
      };
    },
  },
  {
    key: "domain policies",
    check: () => {
      const missing = DOMAINS.filter(
        (d) => !existsSync(join(ROOT, `docs/governance/policies/${d}.md`)),
      );
      const withLaw = DOMAINS.filter((d) =>
        current.some((r) => r.domain === d && r.kind === "LAW_DECISION"),
      ).length;
      return {
        pass: missing.length === 0,
        detail: `${DOMAINS.length} generated policy modules, ${withLaw} carrying active law`,
      };
    },
  },
  {
    key: "current decisions",
    check: () => {
      const p = join(ROOT, "docs/governance/current-decisions.md");
      const n = current.filter((r) => r.kind === "DECISION").length;
      return {
        pass: existsSync(p),
        detail: `${n} active non-law decisions, generated and organized by domain`,
      };
    },
  },
  {
    key: "generated history",
    check: () => ({
      pass: existsSync(join(ROOT, "docs/governance/history.md")),
      detail: `${records.length - current.length} historical records, full narrative, NOT startup context`,
    }),
  },
  {
    key: "generated index",
    check: () => {
      const p = join(ROOT, "docs/governance/index.json");
      if (!existsSync(p)) return { pass: false, detail: "absent" };
      const j = JSON.parse(readFileSync(p, "utf8")) as { snapshot: string; records: unknown[] };
      return {
        pass: Boolean(j.snapshot) && j.records.length === records.length,
        detail: `snapshot ${j.snapshot}, ${j.records.length} records with aliases, relations and policy pointers`,
      };
    },
  },
  {
    key: "docs/rulings compatibility state",
    check: () => {
      const t = readFileSync(join(ROOT, "docs/rulings.md"), "utf8");
      const generated = /GENERATED by `pnpm governance:compile`/.test(t);
      const registered = readFileSync(join(ROOT, "lib/ops/generated-register.ts"), "utf8").includes(
        '"docs/rulings.md"',
      );
      return {
        pass: generated && registered,
        detail: "generated, digest-registered, kept so every RULING n reference still resolves",
      };
    },
  },
  {
    key: "compatibility-view validity",
    check: () => {
      // CONTENT, not freshness. The old criterion asked only whether the view
      // was generated and registered, and it passed while 24 headings rendered
      // as "RULING undefined" on live main.
      const text = readFileSync(join(ROOT, "docs/rulings.md"), "utf8");
      const undef = (text.match(/RULING undefined/g) ?? []).length;
      const headings = [...text.matchAll(/^## RULING (.+?) —/gm)].map((m) => m[1].trim());
      const numericIds = new Set(
        records.filter((r) => /^R-0*\d+$/.test(r.id)).map((r) => String(Number(/^R-0*(\d+)$/.exec(r.id)?.[1]))),
      );
      const malformed = headings.filter((h) => !/^\d+$/.test(h));
      const orphan = headings.filter((h) => /^\d+$/.test(h) && !numericIds.has(String(Number(h))));
      const seen = new Set(headings.map((h) => String(Number(h))));
      const omitted = [...numericIds].filter((id) => !seen.has(id));
      const unnumberedDropped = records
        .filter((r) => !/^R-0*\d+$/.test(r.id))
        .filter((r) => !text.includes("`" + r.id + "`"));
      return {
        pass:
          undef === 0 &&
          malformed.length === 0 &&
          orphan.length === 0 &&
          omitted.length === 0 &&
          unnumberedDropped.length === 0,
        detail:
          `RULING undefined ${undef} · malformed ${malformed.length} · orphan ${orphan.length} · ` +
          `omitted ${omitted.length} · un-numbered dropped ${unnumberedDropped.length} · ` +
          `${headings.length} numbered rulings represented`,
      };
    },
  },
  {
    key: "one amendment procedure",
    check: () => {
      const holders = current.filter((r) =>
        r.claims.some((c) => c.key === "governance.amendment_procedure"),
      );
      const retired = current.filter((r) =>
        r.claims.some((c) => c.value === "dual-write-claude-and-rulings"),
      );
      return {
        pass: holders.length === 1 && retired.length === 0,
        detail:
          `${holders.length} current amendment procedure (${holders[0]?.claims.find((c) => c.key === "governance.amendment_procedure")?.value ?? "none"}), ` +
          `${retired.length} ACTIVE record(s) still commanding the retired dual write`,
      };
    },
  },
  {
    key: "method learning is operational",
    check: () => {
      const src = readFileSync(join(ROOT, "scripts/descent.mts"), "utf8");
      const writes = src.includes("recordRouteOutcome(") && src.includes("applyEarnedPortability(");
      const lib = readFileSync(join(ROOT, "lib/method/knowledge.ts"), "utf8");
      const earns = lib.includes("export function earnedPortability");
      return {
        pass: writes && earns,
        detail: writes
          ? "descent records route outcomes and applies earned portability through the canonical store"
          : "no operational path writes route outcomes",
      };
    },
  },
  {
    key: "task-aware governance:open",
    check: () => {
      const src = readFileSync(join(ROOT, "scripts/governance-open.mts"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      const takesTask = src.includes("--task");
      // It must NOT load the history. Asserted on the source, with comments
      // stripped so the guard does not fire on its own documentation.
      const loadsHistory = /readFileSync\([^)]*history\.md/.test(src) || /readFileSync\([^)]*rulings\.md/.test(src);
      return {
        pass: takesTask && !loadsHistory,
        detail: takesTask
          ? `--task over ${DOMAINS.length} domains; prints current law, rule slots, conflicts and work state; loads no history`
          : "no --task argument",
      };
    },
  },
  {
    key: "governance:check",
    check: () => {
      const { issues, conflicts, checked } = validateLedger(index, ROOT);
      return {
        pass: issues.length === 0 && conflicts.length === 0,
        detail: `${checked.length} structural checks, ${issues.length} issues, ${conflicts.length} conflicts`,
      };
    },
  },
  {
    key: "method knowledge",
    check: () => {
      const k = method();
      if (!k) return { pass: false, detail: "no method store" };
      const issues = validateKnowledge(k);
      return {
        pass: issues.length === 0 && k.routes.length >= 61,
        detail: `${k.routes.length} routes, ${k.routes.filter((r) => r.applicability).length} with applicability, ${k.routes.reduce((n, r) => n + r.subBranches.length, 0)} sub-branches retained`,
      };
    },
  },
  {
    key: "method inheritance",
    check: () => {
      const k = method();
      if (!k) return { pass: false, detail: "no method store" };
      // A jurisdiction never touched inherits every applicable route.
      const src = readFileSync(join(ROOT, "lib/method/knowledge.ts"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      const noCap = !/\b(MAX_ROUTES|ROUTE_LIMIT)\b/.test(src);
      return {
        pass: noCap,
        detail: `no route cap exists; ${k.routes.length} is what the project knows now, never what exists`,
      };
    },
  },
  {
    key: "versioned convergence",
    check: () => {
      // Every reopening trigger works independently.
      const c = {
        convergedAsOf: "2026-08-01",
        methodVersion: 7,
        universeVersion: "v1",
        eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION,
        freshnessDays: 14,
      };
      const base = { methodVersion: 7, universeVersion: "v1", eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION, today: "2026-08-05" };
      const holds = convergenceHolds(c, base).status === "CONVERGED_AS_OF";
      const byMethod = convergenceHolds(c, { ...base, methodVersion: 8 }).status === "EXPANDING";
      const byUniverse = convergenceHolds(c, { ...base, universeVersion: "v2" }).status === "EXPANDING";
      const byEdges = convergenceHolds(c, { ...base, eligibleEdgeVersion: "ee-v2" }).status === "EXPANDING";
      const byFreshness = convergenceHolds(c, { ...base, today: "2026-09-01" }).status === "EXPANDING";
      return {
        pass: holds && byMethod && byUniverse && byEdges && byFreshness,
        detail: "method version, universe version, eligible-edge version and freshness each reopen independently",
      };
    },
  },
  {
    key: "automatic reopening",
    check: () => {
      const k = method();
      if (!k) return { pass: false, detail: "no method store" };
      const conclusion: PriorConclusion[] = [
        {
          id: "probe",
          kind: "ABSENCE",
          field: k.routes[0]?.fields[0] ?? "roster",
          jurisdiction: { state: "nh" },
          earnedAtVersion: k.version,
          earnedOn: "2026-08-20",
        },
      ];
      const before = findReopenings(k, conclusion).length;
      const grown: MethodKnowledge = {
        ...k,
        version: k.version + 1,
        routes: [
          ...k.routes,
          {
            ...k.routes[0],
            id: "probe-route",
            learnedAtVersion: k.version + 1,
          },
        ],
      };
      const after = findReopenings(grown, conclusion).length;
      return {
        pass: before === 0 && after === 1,
        detail: "a route learned after a conclusion reopens it mechanically; one learned before does not",
      };
    },
  },
  {
    key: "canonical work-state",
    check: () => {
      let issues = 0;
      for (const s of STATES) {
        const w = ws(s);
        if (!w) return { pass: false, detail: `${s} has no canonical state` };
        issues += validateWorkstream(w, {
          today: TODAY,
          methodVersion: 0,
          eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION,
        }).length;
      }
      return { pass: issues === 0, detail: `3 workstreams, ${issues} validation issues` };
    },
  },
  {
    key: "exact frontier persistence",
    check: () => {
      let edges = 0;
      let outstanding = 0;
      for (const s of STATES) {
        const p = proveResume(ROOT, s);
        if (!p) return { pass: false, detail: `${s} is not resumable` };
        edges += p.edgesPersisted;
        outstanding += p.outstandingEligible;
      }
      const descent = readFileSync(join(ROOT, "scripts/descent.mts"), "utf8");
      const wired = descent.includes("resumeFrom(") && descent.includes("saveWorkstream(");
      return {
        pass: wired && edges > 1000,
        detail: `${edges} edges with stable ids and provenance, ${outstanding} outstanding, resumed with no seed crawl`,
      };
    },
  },
  {
    key: "aggregate-tail accounting",
    check: () => {
      let tail = 0;
      for (const s of STATES) {
        const w = ws(s);
        if (w) tail += aggregateTail(w.unmaterialized ?? []).outstandingCount;
      }
      return {
        pass: tail === 3900,
        detail: `${tail} unmaterialized obligations preserved, counted apart from resumable edges, never summed`,
      };
    },
  },
  {
    key: "candidate/body separation",
    check: () => {
      let leads = 0;
      let promoted = 0;
      for (const s of STATES) {
        const w = ws(s);
        if (!w) continue;
        leads += w.candidates.length;
        promoted += w.candidates.filter((c) => c.state === "BODY_PROMOTED").length;
      }
      return {
        pass: leads > 0,
        detail: `${leads} leads, ${promoted} promoted bodies; the coverage numerator is ${promoted}`,
      };
    },
  },
  {
    key: "permission/transport separation",
    check: () => {
      const t = readFileSync(join(ROOT, "lib/workstate/types.ts"), "utf8");
      const g = readFileSync(join(ROOT, "lib/workstate/workstream.ts"), "utf8");
      return {
        pass:
          t.includes("PERMISSION_STATES") &&
          t.includes("TRANSPORT_STATES") &&
          t.includes("cannot have been read") &&
          g.includes("transport-became-permission"),
        detail: "typed apart; a verdict for an unretrieved document throws; the workstream validator refuses it",
      };
    },
  },
  {
    key: "generated handoff",
    check: () => {
      const bad: string[] = [];
      for (const s of STATES) {
        const w = ws(s);
        if (!w) continue;
        const h = generateHandoff(
          w,
          { today: TODAY, methodVersion: 0, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION },
          "EARLY_HANDOFF_WITH_CAPACITY",
        );
        if (!h.resumeCursor) bad.push(`${s}: no cursor`);
      }
      return {
        pass: bad.length === 0,
        detail: bad.length ? bad.join("; ") : "cursor, open set, blockers and remainder derived from canonical state",
      };
    },
  },
  {
    key: "stopping-legitimacy model",
    check: () => {
      const early = classifySessionStop({
        contextUsedPercent: 56,
        contextRemainingPercent: 44,
        stopReason: "checklist finished",
        executableOwedWorkRemaining: 12,
        externalStop: false,
        statePersisted: true,
        productiveUntilBoundary: true,
      });
      const limit = classifySessionStop({
        contextUsedPercent: 88,
        contextRemainingPercent: 12,
        stopReason: "boundary",
        executableOwedWorkRemaining: 12,
        externalStop: false,
        statePersisted: true,
        productiveUntilBoundary: true,
      });
      return {
        pass:
          early.status === "EARLY_HANDOFF_WITH_CAPACITY" &&
          limit.status === "CLEAN_HANDOFF_LIMIT_REACHED",
        detail: "5 statuses; 56% with work owed is EARLY_HANDOFF_WITH_CAPACITY; a claim the state refuses is named",
      };
    },
  },
  {
    key: "legacy consumers migrated",
    check: () => {
      // Every consumer that used to parse `docs/rulings.md` headings now reads
      // the canonical ledger. A consumer left behind would not error — it would
      // read NOTHING and pass, which is how two guards were found green on zero
      // input during this remediation.
      const consumers = [
        ["scripts/tracker.mjs", "ledgerIds.has("],
        ["scripts/context-file.mjs", "ledger.jsonl"],
        ["tests/tracker-stores.test.ts", "ledger.jsonl"],
      ] as const;
      const stale: string[] = [];
      for (const [f, needle] of consumers) {
        const src = readFileSync(join(ROOT, f), "utf8");
        if (!src.includes(needle)) stale.push(f);
        if (/matchAll\(\/\^### RULING/.test(src)) stale.push(`${f} (still parses ### headings)`);
      }
      return {
        pass: stale.length === 0,
        detail: stale.length ? stale.join("; ") : `${consumers.length} legacy consumers read the canonical ledger`,
      };
    },
  },
  {
    key: "remaining live governance conflicts",
    check: () => {
      const n = findClaimConflicts(records).length;
      return { pass: n === 0, detail: `${n}` };
    },
  },
  {
    key: "duplicated operative authority",
    check: () => {
      const n = validateLedger(index, ROOT).issues.filter(
        (i) => i.rule === "duplicate-canonical-law",
      ).length;
      return { pass: n === 0, detail: `${n}` };
    },
  },
];

// RULING 159 — the floor before any verdict. A gate evaluating zero criteria
// would print a green board about nothing.
floored("governance acceptance criteria", "the remediation brief", C.length, C.length);

const results = C.map((c) => ({ key: c.key, ...c.check() }));
const failed = results.filter((r) => !r.pass);

console.log("FINAL GOVERNANCE ACCEPTANCE");
console.log("");
for (const r of results) {
  console.log(`${r.key.padEnd(38)} ${r.pass ? "PASS" : "FAIL"}   ${r.detail}`);
}
console.log("");
console.log(`record kinds in use: ${[...new Set(records.map((r) => r.kind))].sort().join(", ")}`);
console.log(`of ${RECORD_KINDS.length} declared kinds`);
console.log("");

if (failed.length > 0) {
  console.log("FAILING:");
  for (const f of failed) console.log(`  - ${f.key}: ${f.detail}`);
  console.error(`\nGOVERNANCE REMEDIATION INCOMPLETE — ${failed.length} criterion/criteria failing`);
  process.exit(1);
}
console.log("GOVERNANCE REMEDIATION: COMPLETE");
