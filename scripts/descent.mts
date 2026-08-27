/**
 * `pnpm descent --state <code>` — WALK THE TIERS, AND COUNT THE WALK.
 * (2026-08-26, the descent session, Items 3 and 11. **RULING 169**.)
 *
 * Coverage is built by descending the tiers of government in order, because
 * each tier publishes the tier beneath it. This is the instrument that makes
 * that falsifiable: it walks each tier's seed as a tree, follows what it names,
 * and reports **links found · followed · yielded · declined with reason ·
 * catalogued · bodies discovered that were not already in the registry**, per
 * level, per state — plus the pass count and the final pass's new-link count.
 *
 * ## Permission first, always
 *
 * RULING 148: every host is judged by `robots.txt` BEFORE the first byte, and
 * `CANNOT_TELL` refuses. The permission read itself walks the ladder to rung 4,
 * because a host refusing our User-Agent is a WALL and reading it as a RULE
 * silently removed `az.gov` and `nh.gov` from this project on 2026-08-26.
 *
 * ## What it writes
 *
 * `states/<code>/descent.json` — the ledger, which `lib/hunt/descent-gate.ts`
 * re-derives the arithmetic of rather than trusting.
 * `states/<code>/descent.md` — the same walk for a person, per level.
 *
 * ## Fail closed
 *
 * RULING 159. Zero levels is a run that did not happen; zero bodies at the
 * state or county tier is a broken walk rather than a finding. Both throw.
 *
 * Usage:
 *   pnpm descent --state az
 *   pnpm descent --state az --passes 2 --budget 120
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertRun,
  darkTiers,
  TIERS,
  totalFollowed,
  totalFound,
  totalNewCandidates,
  walkVerdict,
  type DeclinedLink,
  type DescentLevel,
  type DescentRun,
  type TierId,
} from "../lib/hunt/descent.ts";
import { seedsFor, type DescentSeed } from "../lib/hunt/descent-seeds.ts";
import {
  deriveCursor,
  edgeId,
  loadWorkstream,
  planDescentStart,
  recordDiscovery,
  recordProcessed,
  resumeFrom,
  saveWorkstream,
} from "../lib/workstate/frontier.ts";
import { recordCandidate } from "../lib/workstate/candidates.ts";
import type { Workstream } from "../lib/workstate/workstream.ts";
import { loadMethodStore } from "../lib/workstate/load.ts";
import {
  applyEarnedPortability,
  learnRoute,
  recordRouteOutcome,
} from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import {
  controlHolds,
  extractLinks,
  isGovernmentHost,
  isWalkable,
  looksLikeBody,
  type FoundLink,
} from "../lib/hunt/descent-walk.ts";
import { today } from "./doc-dates.mjs";
import { judgeUrl } from "./robots-sweep.mts";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Fetch one page, escalating to rung 4.
 *
 * The same ladder the permission read walks, for the same reason: `az.gov` and
 * `nh.gov` refuse Node's `fetch` at rungs 2 and 3 and admit `curl` carrying the
 * identical header set at rung 3's headers. A walk that stopped at rung 3 would
 * report those two states as unreachable while their front doors serve to
 * anybody with a browser.
 */
async function getPage(url: string): Promise<{ status: number; html: string; rung: number } | null> {
  const rungs: { rung: number; headers: Record<string, string> }[] = [
    { rung: 2, headers: { "user-agent": "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)", accept: "text/html,*/*" } },
    {
      rung: 3,
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    },
  ];
  for (const step of rungs) {
    try {
      const res = await fetch(url, { headers: step.headers, redirect: "follow", signal: AbortSignal.timeout(25_000) });
      if (res.ok) return { status: res.status, html: await res.text(), rung: step.rung };
    } catch {
      /* next rung — a transport failure is not an answer */
    }
  }
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run(
      "curl",
      ["-sL", "--max-time", "25", "-w", "\n__WTP__%{http_code}", "-A", BROWSER_UA, "-H", "Accept-Language: en-US,en;q=0.9", url],
      { timeout: 40_000, maxBuffer: 24 * 1024 * 1024 },
    );
    const cut = stdout.lastIndexOf("\n__WTP__");
    if (cut < 0) return null;
    const status = Number(stdout.slice(cut + "\n__WTP__".length).trim());
    if (status >= 200 && status < 300) return { status, html: stdout.slice(0, cut), rung: 4 };
  } catch {
    /* rung 4 failed too */
  }
  return null;
}

/** Hosts already judged this run, so one question is asked once per host. */
const permission = new Map<string, boolean>();

async function mayWalk(url: string): Promise<{ ok: boolean; verdict: string }> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, verdict: "unparseable" };
  }
  const cached = permission.get(host);
  const v = await judgeUrl(url);
  const ok = v.verdict === "ALLOWED" || v.verdict === "NO_ROBOTS";
  if (cached === undefined) permission.set(host, ok);
  return { ok, verdict: v.verdict };
}

/** Every body id the registry already holds, for the one column that matters. */
function knownBodyNames(state: string): Set<string> {
  const reg = JSON.parse(readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8")) as {
    bodies: { id?: string; ocdId?: string; name?: string | null }[];
  };
  const out = new Set<string>();
  for (const b of reg.bodies) {
    const id = b.ocdId ?? b.id ?? "";
    if (!id.includes(`state:${state}`)) continue;
    if (b.name) out.add(b.name.toLowerCase().replace(/\s+/g, " ").trim());
    const tail = id.split("/").pop();
    if (tail) out.add(tail.replace(/^[a-z_]+:/, "").replace(/_/g, " ").toLowerCase());
  }
  return out;
}

interface LevelWork {
  readonly tier: TierId;
  found: number;
  followed: number;
  yielded: number;
  barren: number;
  declined: DeclinedLink[];
  catalogued: number;
  candidatesNew: number;
  candidatesKnown: number;
  vocabulary: Set<string>;
  /** Bodies discovered, named, for the catalog and for the report. */
  discovered: { name: string; url: string; known: boolean }[];
}

function blankLevel(tier: TierId): LevelWork {
  return {
    tier,
    found: 0,
    followed: 0,
    yielded: 0,
    barren: 0,
    declined: [],
    catalogued: 0,
    candidatesNew: 0,
    candidatesKnown: 0,
    vocabulary: new Set(),
    discovered: [],
  };
}

async function main(): Promise<void> {
  const state = (arg("state") ?? "").trim().toLowerCase();
  if (!state) throw new Error("pnpm descent --state <code>   (a descent without a state is not a descent)");

  const passes = Number(arg("passes") ?? 2);
  /* A per-level fetch budget. Named a BUDGET rather than a limit because it is
   * a floor on effort per RULING 170 — reaching it is reported, never treated
   * as the level being finished. */
  const budget = Number(arg("budget") ?? 40);

  /*
   * The seed list no longer GATES the run — `planDescentStart` decides, and
   * `scripts/descent-resume-proof.mts` calls the same function.
   *
   * This used to be `if (seeds.length === 0) throw`, which meant recovering
   * 1,614 already-persisted edges depended on the seed initializer being
   * present. The frontier helper was seed-free and the proof said so, but the
   * executable command was not, and the proof never called it.
   *
   * Seeds still initialize a jurisdiction with no canonical state, and they are
   * still tier roots worth re-reading (RULING 93). Neither is a prerequisite
   * for resuming work already on disk.
   */
  const seeds = seedsFor(state);
  const plan = planDescentStart(ROOT, state, seeds.length);
  console.log(`PLAN ${plan.mode} — ${plan.reason}`);
  if (plan.mode === "REFUSED") throw new Error(plan.reason);
  if (plan.mode === "RESUME" && !plan.rootRecheckAvailable) {
    // Named as its own skipped work rather than folded into recovery, so a
    // report can never read a partial run as a complete one.
    console.log("     top-of-tier recheck SKIPPED this run — no tier roots available");
  }

  const known = knownBodyNames(state);
  const stamp = today();
  const levels = new Map<TierId, LevelWork>();
  const visited = new Set<string>();
  /* Links seen but not yet walked, per tier — this is what makes a second pass
   * mean something and what the final pass's new-link count is measured from. */
  const frontier = new Map<TierId, FoundLink[]>();

  /*
   * RULING 181 — A FRONTIER IS STATE, NOT A RECIPE FOR RECREATING STATE.
   *
   * Seeds INITIALIZE a workstream that does not exist yet. Once one does, the
   * canonical store is where outstanding work lives, and this run resumes from
   * it rather than re-walking seeds to rediscover edges a previous session had
   * already found.
   *
   * That was not true before 2026-08-26: the frontier lived only in this Map,
   * and `descent.json` persisted its COUNT. NJ's last run left 1,986 edges
   * queued and wrote down the number 1,986.
   */
  const ws = loadWorkstream(ROOT, state);
  let resumed = 0;
  if (ws) {
    const r = resumeFrom(ROOT, state);
    if (r) {
      for (const [tier, queued] of r.queuedByTier) {
        if (!levels.has(tier as TierId)) levels.set(tier as TierId, blankLevel(tier as TierId));
        frontier.set(tier as TierId, [
          ...(frontier.get(tier as TierId) ?? []),
          ...queued.map((q) => ({ url: q.url, text: q.text })),
        ]);
        resumed += queued.length;
      }
      for (const u of r.visited) visited.add(u);
      // A resumed URL is outstanding, not walked. Re-adding it to `visited`
      // above would make the resume skip its own queue on the first pass.
      for (const q of [...r.queuedByTier.values()].flat()) visited.delete(q.url);
    }
    console.log(
      `RESUMED from canonical state — ${resumed} outstanding edge(s), ` +
        `${ws.edges.length} persisted, seeds NOT consulted for outstanding work`,
    );
  }

  // Seeds are still walked as the TOP of each tier — they are the tier above's
  // own directory (RULING 93) and re-reading them is how a moved directory is
  // noticed. What is no longer rebuilt from them is the OUTSTANDING QUEUE.
  for (const s of seeds) {
    if (!levels.has(s.tier)) levels.set(s.tier, blankLevel(s.tier));
    if (visited.has(s.url)) continue;
    frontier.set(s.tier, [...(frontier.get(s.tier) ?? []), { url: s.url, text: s.publisher }]);
  }

  const workstream: Workstream = ws ?? {
    id: `descent:${state}`,
    title: `Descent — ${state.toUpperCase()}`,
    openedOn: stamp,
    universe: {
      authority: `descent tier structure declared by lib/hunt/descent-seeds.ts for ${state}`,
      version: `seeded-${stamp}`,
      members: [...new Set(seeds.map((s) => `${state}:${s.tier}`))],
    },
    items: [],
    edges: [],
    candidates: [],
    permissions: [],
    cursor: null,
    convergence: null,
    // A brand-new workstream carries no historical obligation: it has not lost
    // anything yet, because from its first pass every edge is persisted.
    unmaterialized: [],
    routesInherited: [],
    routesLearned: [],
    methodVersion: 0,
  };

  let finalPassNewLinks = 0;

  for (let pass = 1; pass <= passes; pass++) {
    let newThisPass = 0;
    console.log(`\n=== ${state.toUpperCase()} — PASS ${pass} of ${passes}`);

    for (const [tier, work] of levels) {
      const queue = frontier.get(tier) ?? [];
      frontier.set(tier, []);
      let spent = 0;

      for (const link of queue) {
        if (spent >= budget) {
          work.declined.push({ url: link.url, reason: "DEPTH_LIMIT" });
          work.found += 1;
          continue;
        }
        if (visited.has(link.url)) {
          work.declined.push({ url: link.url, reason: "ALREADY_RECORDED" });
          work.found += 1;
          continue;
        }
        work.found += 1;

        const walkable = isWalkable(link.url);
        if (!walkable.ok) {
          work.declined.push({ url: link.url, reason: "NOT_A_DOCUMENT" });
          continue;
        }
        const perm = await mayWalk(link.url);
        if (!perm.ok) {
          work.declined.push({
            url: link.url,
            reason: perm.verdict === "DISALLOWED" ? "DISALLOWED" : "PERMISSION_UNKNOWN",
          });
          continue;
        }

        visited.add(link.url);
        spent += 1;
        // The edge leaves the outstanding queue the moment it is walked, in
        // canonical state as well as in memory. An edge that stayed
        // DISCOVERED after being walked would be re-walked on every resume.
        recordProcessed(workstream, edgeId(state, tier, link.url, link.text), "IN_PROGRESS", stamp);
        const page = await getPage(link.url);
        work.followed += 1;

        if (!page) {
          /* A link we ASKED FOR and were refused is FOLLOWED and BARREN, never
           * DECLINED — declined means we chose not to ask. Running the two
           * together would report a wall as a decision, which is the failure
           * the transparency mandate names first: a wall never renders as an
           * emptiness. The wall is dated by this run's stamp (RULING 53). */
          work.barren += 1;
          console.log(`  UNREACHABLE     ${link.url} — refused at every rung through 4`);
          continue;
        }

        const seed = seeds.find((s) => s.url === link.url);
        if (seed && !controlHolds(page.html, seed.control)) {
          /* RULING 93: a 200 whose content is not about the thing asked for is
           * not a document. `nj.gov/nj/gov/county/` is the live case. */
          work.barren += 1;
          console.log(`  CONTROL FAILED  ${link.url} — "${seed.control}" absent from a HTTP ${page.status}`);
          continue;
        }

        const links = extractLinks(page.html, link.url);
        let bodiesHere = 0;
        for (const l of links) {
          const sig = looksLikeBody(l);
          if (!sig.isBody) continue;
          const name = l.text.toLowerCase().replace(/\s+/g, " ").trim();
          /* A name shorter than five characters is not a body name, and the
           * matcher below would pair it with half the registry. */
          if (!name || name.length < 5 || name.length > 90) continue;
          if (work.discovered.some((d) => d.name === name)) continue;
          const isKnown = [...known].some((k) => k.length > 4 && (name.includes(k) || k.includes(name)));
          work.discovered.push({ name, url: l.url, known: isKnown });
          if (isKnown) work.candidatesKnown += 1;
          else work.candidatesNew += 1;
          bodiesHere += 1;
          /*
           * PERSISTED AS A LEAD, IN THE PASS THAT NAMED IT.
           *
           * This line did not exist until 2026-08-26 (the descent-resume
           * session), and its absence is why the coverage numerator could not
           * move. `work.discovered` is an in-memory array that reaches
           * `descent-candidates.md` and stops there; every candidate in
           * canonical state got in by `workstream-migrate.mts` parsing that
           * markdown ONCE. A walk could run forever and add no lead.
           *
           * That is RULING 181's defect wearing a different coat — the edge
           * frontier was fixed by persisting on discovery and the candidate
           * pool was not. It is fixed the same way and for the same reason.
           *
           * It is a LEAD. It is `ENTITY_CANDIDATE` and it counts toward
           * nothing until something opens it (RULING 183).
           */
          recordCandidate(workstream, {
            state,
            tier,
            url: l.url,
            text: l.text,
            fromEdge: edgeId(state, tier, link.url, link.text),
            discoveredOn: stamp,
          });
          /* Vocabulary is the state's OWN word for this tier, taken from the
           * state's own page rather than imposed (RULING 57, brief Item 2). */
          for (const w of ["township", "borough", "village", "plantation", "precinct", "parish", "town", "city", "district"]) {
            if (name.includes(w)) work.vocabulary.add(w);
          }
        }

        /* Same-host links feed the next pass. Off-host links are a real find and
         * are recorded, but following every outbound link is a crawl of the web
         * rather than a descent of a government. */
        const host = new URL(link.url).host;
        for (const l of links) {
          if (visited.has(l.url)) continue;
          try {
            if (new URL(l.url).host !== host) continue;
          } catch {
            continue;
          }
          if (!looksLikeBody(l).isBody) continue;
          frontier.set(tier, [...(frontier.get(tier) ?? []), l]);
          // PERSISTED IN THE SAME PASS THAT FOUND IT. If this process dies on
          // the next line, this edge is on disk and the next session inherits
          // it — which is the whole of RULING 181. Queuing it in memory and
          // writing the COUNT is what left 3,900 edges unrecoverable.
          const { isNew } = recordDiscovery(workstream, {
            state,
            tier,
            url: l.url,
            text: l.text,
            parent: edgeId(state, tier, link.url, link.text),
            discoveredOn: stamp,
          });
          if (isNew) newThisPass += 1;
        }

        if (bodiesHere > 0) {
          work.yielded += 1;
          work.catalogued += 1;
        } else {
          work.barren += 1;
        }
        recordProcessed(
          workstream,
          edgeId(state, tier, link.url, link.text),
          bodiesHere > 0 ? "INGESTED" : "WALKED_NO_YIELD",
          stamp,
        );
        console.log(
          `  rung ${page.rung}  HTTP ${page.status}  ${bodiesHere} bod${bodiesHere === 1 ? "y" : "ies"}  ${link.url}`,
        );
      }
    }

    finalPassNewLinks = newThisPass;
    console.log(`--- pass ${pass}: ${newThisPass} new link(s) queued`);

    /*
     * Persist AFTER EVERY PASS, with the cursor derived from what is on disk.
     * A run killed between passes therefore loses nothing it had discovered,
     * and the next session resumes from the exact edge this one stopped at.
     *
     * `passes` and `budget` choose HOW MUCH queued work this run processes.
     * They do not decide what work exists — that is the canonical store's job,
     * and it is the distinction RULING 181 was adopted over.
     */
    workstream.cursor = `${deriveCursor(workstream, state)} / after pass ${pass} of ${passes}`;
    saveWorkstream(ROOT, workstream);
    console.log(
      `    persisted ${workstream.edges.length} edge(s) to data/workstate/${state}.json`,
    );
  }

  const run: DescentRun = {
    state,
    startedOn: stamp,
    passes,
    finalPassNewLinks,
    levels: [...levels.values()].map(
      (w): DescentLevel => ({
        state,
        tier: w.tier,
        vocabulary: [...w.vocabulary].sort(),
        found: w.found,
        followed: w.followed,
        yielded: w.yielded,
        barren: w.barren,
        declined: w.declined,
        catalogued: w.catalogued,
        candidatesNew: w.candidatesNew,
        candidatesKnown: w.candidatesKnown,
        pass: passes,
        walkedOn: stamp,
      }),
    ),
  };

  assertRun(run);

  const dir = join(ROOT, "states", state);
  mkdirSync(dir, { recursive: true });
  /*
   * WRITE WHAT THE ROUTES ACTUALLY DID (Finding 4 of the 2026-08-26 audit).
   *
   * Before this, `method-ingest` created 61 routes with `outcomes: []` and
   * nothing ever wrote one. Every route could have stayed `UNKNOWN` forever
   * while the report said "the first few descent runs will start classifying
   * them" — a claim about an execution path that did not exist.
   *
   * The tier descent IS a route, and it is the one this command walks. Its
   * outcome per tier is recorded here, through the canonical store, on the same
   * run that earned it.
   *
   * ZERO is recorded, not swallowed: a walked tier that named no bodies is
   * knowledge (RULING 88), and a route that keeps returning ZERO somewhere is
   * exactly the evidence a later session needs.
   */
  const store = loadMethodStore(ROOT);
  if (store) {
    let k = store;
    let recorded = 0;
    for (const [tier, work] of levels) {
      const routeId = `descent-tier-${tier}`;
      // The tier route enters project knowledge the first time it is walked.
      // No cap is consulted; there is none to consult.
      if (!k.routes.some((r) => r.id === routeId)) {
        k = learnRoute(
          k,
          {
            id: routeId,
            title: `tier descent — ${tier}: walk what the tier above publishes about this one`,
            tier: "A0",
            fields: ["body", "roster"],
            applicability: unknownApplicability(
              "the tier-descent shape; portability is EARNED from recorded outcomes, never assumed",
            ),
            outcomes: [],
            subBranches: [],
            origin: "scripts/descent.mts",
            learnedOn: stamp,
          },
          stamp,
        ).knowledge;
      }
      const res = recordRouteOutcome(k, routeId, {
        jurisdiction: state,
        walkedOn: stamp,
        rows: work.candidatesNew,
        // A tier that was walked and named nothing is ZERO. A tier nothing
        // could be fetched from is FAILED — a fact about the attempt, and one
        // that must never narrow the route's jurisdictional applicability.
        outcome: work.followed === 0 ? "FAILED" : work.candidatesNew > 0 ? "YIELDED" : "ZERO",
        note: `found ${work.found}, followed ${work.followed}, yielded ${work.yielded}, barren ${work.barren}`,
      });
      k = res.knowledge;
      if (res.recorded) recorded += 1;
    }

    // Portability is applied from the evidence now on the record. Widening
    // needs breadth; narrowing needs a DECLARED jurisdictional failure, which
    // this command never asserts — a walk that could not fetch is a fact about
    // the fetch (RULING 182).
    const { knowledge, moved } = applyEarnedPortability(k);
    writeFileSync(
      join(ROOT, "data", "method", "knowledge.json"),
      `${JSON.stringify({ ...knowledge, updatedOn: stamp }, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `\nmethod store: ${recorded} outcome(s) recorded, ${moved.length} portability change(s), v${knowledge.version}`,
    );
    for (const m of moved) console.log(`  ${m.id}: ${m.from} -> ${m.to} — ${m.because}`);
  }

  writeFileSync(join(dir, "descent.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");

  const v = walkVerdict(run);
  const lines: string[] = [
    `# ${state.toUpperCase()} — the descent`,
    "",
    `**Walked ${stamp}** by \`pnpm descent --state ${state}\`. RULING 169 — a walk is counted or it did not`,
    "happen. Every number below is per LEVEL, because a run total hides the level that returned nothing.",
    "",
    `**Verdict: ${v.finished ? "FINISHED" : "STOPPED"}** — ${v.reason}`,
    "",
    "| Tier | Found | Followed | Yielded | Barren | Declined | Catalogued | Candidates NEW | Candidates known |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const t of TIERS) {
    const l = run.levels.find((x) => x.tier === t.id);
    if (!l) continue;
    lines.push(
      `| **${t.title}** | ${l.found} | ${l.followed} | ${l.yielded} | ${l.barren} | ${l.declined.length} | ` +
        `${l.catalogued} | **${l.candidatesNew}** | ${l.candidatesKnown} |`,
    );
  }
  const dark = darkTiers(run);
  lines.push(
    "",
    `**Totals: ${totalFound(run)} found · ${totalFollowed(run)} followed · ${totalNewCandidates(run)} CANDIDATE ` +
      "bodies not already matched in the registry.** That last number is the one that says whether the descent " +
      "worked; every other column measures effort.",
    "",
    "**They are CANDIDATES and not bodies, and the distinction is load-bearing.** A candidate is a link whose text",
    "named a governing body; confirming it is a body, resolving it to a division and giving it an id is the next",
    "motion. Reporting this number as *bodies discovered* would be a claim about coverage this product does not",
    "have — the partial that reconciles (RULING 100). Detection is recall-first on purpose (RULING 57): a false",
    "positive is a row somebody reads and deletes, and a false negative is a township water authority nobody ever",
    "hears of again.",
    "",
    dark.length === 0
      ? "**No tier in this state is dark.**"
      : `**Tiers with no body held at all: ${dark.join(", ")}.** That is the map of what is missing.`,
    "",
    "## Why each level was declined where it was",
    "",
    "| Tier | Reason | Count |",
    "|---|---|---|",
  );
  for (const l of run.levels) {
    const by = new Map<string, number>();
    for (const d of l.declined) by.set(d.reason, (by.get(d.reason) ?? 0) + 1);
    for (const [reason, n] of [...by].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${l.tier} | \`${reason}\` | ${n} |`);
    }
  }
  /*
   * THE CANDIDATES THEMSELVES, NAMED.
   *
   * RULING 57: a count is not a name, and a village water district disappears
   * into a statistic the moment it is only counted. A run that reported "596"
   * and kept the 596 in memory would have spent the discovery and kept nothing
   * — the failure the append-only playbook rule names in as many words.
   *
   * Written per tier, alphabetically, with the URL each was seen at and whether
   * the registry already holds something matching the name. This file is what
   * the next session sifts; it is deliberately NOT the registry, because
   * promoting a candidate to a body is a separate motion with its own evidence.
   */
  const found: string[] = [
    `# ${state.toUpperCase()} — candidate bodies from the descent`,
    "",
    `**Walked ${stamp}** by \`pnpm descent --state ${state}\`. One row per candidate, per tier.`,
    "",
    "**These are CANDIDATES, not bodies.** A candidate is a link whose text named a governing body. Confirming",
    "it, resolving it to a division and giving it an id is the next motion, and until that happens this file is",
    "a work queue rather than coverage. Detection is recall-first (RULING 57): a false positive is a row",
    "somebody deletes, a false negative is a body nobody hears of again.",
    "",
  ];
  for (const t of TIERS) {
    const w = levels.get(t.id);
    if (!w || w.discovered.length === 0) continue;
    found.push(`## ${t.title}`, "", `${w.discovered.length} candidate(s).`, "", "| Candidate | Already matched | Seen at |", "|---|---|---|");
    for (const d of [...w.discovered].sort((a, b) => a.name.localeCompare(b.name))) {
      found.push(`| ${d.name.replace(/\|/g, "\\|")} | ${d.known ? "yes" : "**no**"} | ${d.url} |`);
    }
    found.push("");
  }
  writeFileSync(join(dir, "descent-candidates.md"), `${found.join("\n")}\n`, "utf8");

  writeFileSync(join(dir, "descent.md"), `${lines.join("\n")}\n`, "utf8");

  console.log(`\n${lines.slice(6).join("\n")}`);
  console.log(`\nwrote states/${state}/descent.json and states/${state}/descent.md`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
