/**
 * **CRAWL THE GOVERNMENT GRAPH — Tier A, exploratory, not a list.**
 * (NJ Hunt 5 item 10, 2026-08-22.)
 *
 * ```
 * pnpm wiki:graph --zip 07866 --state "New Jersey" --budget 300
 * pnpm wiki:graph --zip 03255 --state "New Hampshire"
 * ```
 *
 * Seeds from the municipality articles for a zip and follows every link that
 * resolves to a governmental entity touching that zip, then follows again. There
 * is **no depth cap** — a branch stops when it leaves government. What bounds
 * the run is a FETCH BUDGET, and when it binds, the unexpanded frontier is
 * written out by name so the clip is a stated number rather than an implied
 * completeness.
 *
 * ## The artifact is the point, not the counts
 *
 * `data/hunt/wiki-graph-<zip>.json` records the graph AS WALKED: every node with
 * its Wikipedia URL and entity type, every edge followed, what each node yielded,
 * and every branch that terminated with the reason. **Nodes that returned
 * nothing are kept** — a route that failed is as reusable as one that worked, and
 * keeping it is what stops the next state paying for the same discovery twice
 * (RULING 63).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  type GraphNode,
  type Scope,
  buildNode,
  expansionPriority,
  fetchPageWithCategories,
  titleReject,
} from "../lib/hunt/wiki-graph.ts";
import { WIKI_SPACING_MS, WIKI_USER_AGENT } from "../lib/hunt/wikipedia.ts";
import { today } from "./doc-dates.mjs";

const AS_OF = today();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const zip = arg("--zip") ?? "07866";
const stateName = arg("--state") ?? "New Jersey";
const budget = Number(arg("--budget") ?? "300");

/** Seeds per zip — the municipality articles for the places in it. */
const SEEDS: Record<string, string[]> = {
  "07866": [
    "Rockaway Township, New Jersey",
    "Rockaway, New Jersey",
    "Denville, New Jersey",
    // RULING 87 at the STATE tier: the structure article enumerates every
    // executive department and links each to its own official site. It is
    // seeded rather than waited for, because it is three hops from a
    // municipality and it is the richest node in the graph.
    "Government of New Jersey",
  ],
  "03255": [
    "Newbury, New Hampshire",
    "Sunapee, New Hampshire",
    "Bradford, New Hampshire",
    "Government of New Hampshire",
  ],
};

/**
 * Federal titles this zip's representation actually names. `United States
 * Congress` is in scope for a Rockaway reader; `Government of Alaska` is reached
 * from the same page and is not.
 */
const FEDERAL_ALLOW: Record<string, string[]> = {
  "07866": [
    "United States Congress",
    "United States Senate",
    "United States House of Representatives",
    "119th United States Congress",
  ],
  "03255": [
    "United States Congress",
    "United States Senate",
    "United States House of Representatives",
    "119th United States Congress",
  ],
};

const seeds = SEEDS[zip];
if (seeds === undefined) {
  console.error(`no seeds for ${zip} — add them to SEEDS in this script`);
  process.exit(2);
}
const scope: Scope = { state: stateName, federalAllow: FEDERAL_ALLOW[zip] ?? [] };

const fetcher = async (url: string): Promise<{ status: number; body: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": WIKI_USER_AGENT, Accept: "*/*" },
      signal: controller.signal,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};

/* ── The walk ───────────────────────────────────────────────────────────── */

interface Edge {
  from: string;
  to: string;
  /** FOLLOWED, or the reason it was not. */
  outcome:
    | "FOLLOWED"
    | "ALREADY_VISITED"
    | "TITLE_REJECTED"
    | "NOT_GOVERNMENTAL"
    | "OUT_OF_SCOPE"
    | "BUDGET_EXHAUSTED"
    | "FETCH_FAILED";
  detail: string | null;
}

const nodes = new Map<string, GraphNode>();
const edges: Edge[] = [];
/**
 * The frontier, kept in PRIORITY order rather than in arrival order. A plain
 * FIFO spends the whole budget at depth 1, because one municipality article
 * carries 150-350 links; ordering by `expansionPriority` puts the departments,
 * commissions and courts ahead of the next municipality. Depth is still
 * uncapped — this changes WHICH links are reached, never how deep.
 */
const queue: { title: string; depth: number; from: string | null; priority: number }[] =
  seeds.map((t) => ({ title: t, depth: 0, from: null, priority: -1 }));

function takeNext(): { title: string; depth: number; from: string | null } | undefined {
  if (queue.length === 0) return undefined;
  let best = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].priority < queue[best].priority) best = i;
  }
  return queue.splice(best, 1)[0];
}
const queued = new Set(seeds.map((t) => t.toLowerCase()));
let fetches = 0;

console.log(`crawling the government graph from ${zip} — ${seeds.length} seeds, budget ${budget}`);

while (queue.length > 0) {
  const item = takeNext();
  if (item === undefined) break;

  if (fetches >= budget) {
    // The clip is STATED, never silent. Everything still queued is recorded.
    if (item.from !== null) {
      edges.push({
        from: item.from,
        to: item.title,
        outcome: "BUDGET_EXHAUSTED",
        detail: `fetch budget ${budget} reached`,
      });
    }
    continue;
  }

  fetches++;
  const page = await fetchPageWithCategories(item.title, fetcher, AS_OF);
  await sleep(WIKI_SPACING_MS);

  const node = buildNode(page, item.depth, item.from, scope);
  nodes.set(item.title.toLowerCase(), node);

  if (item.from !== null) {
    edges.push({
      from: item.from,
      to: item.title,
      outcome: page.missReason === null ? "FOLLOWED" : "FETCH_FAILED",
      detail: page.missReason,
    });
  }

  if (page.missReason !== null) {
    node.notExpandedBecause = `not fetched: ${page.missReason}`;
    console.log(`  ${String(fetches).padStart(3)} ✗ ${item.title} — ${page.missReason}`);
    continue;
  }

  // A SEED is expanded whatever its categories say — a municipality article is
  // the doorway, and rejecting it on a category technicality would end the crawl
  // before it started.
  const isSeed = item.depth === 0;
  if (!isSeed && !node.classification.governmental) {
    node.notExpandedBecause = "not classified governmental by its categories";
    console.log(`  ${String(fetches).padStart(3)} · ${item.title} — not governmental`);
    continue;
  }
  if (!isSeed && !node.inScope) {
    node.notExpandedBecause = `governmental but outside ${stateName} and not federally in scope for ${zip}`;
    console.log(`  ${String(fetches).padStart(3)} · ${item.title} — out of scope`);
    continue;
  }

  node.expanded = true;
  console.log(
    `  ${String(fetches).padStart(3)} ✓ ${item.title.slice(0, 54).padEnd(54)} ` +
      `${(node.classification.kind ?? "SEED").padEnd(24)} d${item.depth} ` +
      `sites ${node.officialSites.length} meet ${node.meetingLinks.length} out ${node.outboundGovernmental.length}`,
  );

  for (const target of node.outboundGovernmental) {
    const key = target.toLowerCase();
    if (queued.has(key)) {
      edges.push({ from: item.title, to: target, outcome: "ALREADY_VISITED", detail: null });
      continue;
    }
    const rejected = titleReject(target);
    if (rejected !== null) {
      edges.push({ from: item.title, to: target, outcome: "TITLE_REJECTED", detail: rejected });
      continue;
    }
    queued.add(key);
    queue.push({
      title: target,
      depth: item.depth + 1,
      from: item.title,
      priority: expansionPriority(target),
    });
  }
}

/* ── Reconciling against the registry ───────────────────────────────────── */

const held = (await (await import("../lib/geo/zip-division-index.ts")).zipDivisionEntry(zip))?.ids ?? [];

const expanded = [...nodes.values()].filter((n) => n.expanded);
const governmentalNodes = expanded.filter((n) => n.classification.governmental || n.depth === 0);

/**
 * A body the graph found and the registry does not hold. Matched loosely on the
 * article title against the OCD-ID slugs, because the two vocabularies were
 * never designed to agree — a loose match OVER-reports what is held, which is
 * the safe direction for this claim.
 */
const slugs = held.map((id) => id.split("/").pop()?.split(":").pop() ?? "");
function heldAlready(title: string): boolean {
  const t = title.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return slugs.some((s) => s.length > 3 && (t.includes(s) || s.includes(t)));
}
const notInRegistry = governmentalNodes.filter((n) => !heldAlready(n.resolvedTitle ?? n.title));

const totals = {
  fetches,
  budget,
  nodesVisited: nodes.size,
  nodesExpanded: expanded.length,
  entitiesDiscovered: governmentalNodes.length,
  officialSitesHarvested: [
    ...new Set(expanded.flatMap((n) => n.officialSites.map((l) => l.url))),
  ].length,
  meetingSchedulesFound: [...new Set(expanded.flatMap((n) => n.meetingLinks.map((l) => l.url)))]
    .length,
  edgesRecorded: edges.length,
  edgesFollowed: edges.filter((e) => e.outcome === "FOLLOWED").length,
  frontierLeftUnexpanded: edges.filter((e) => e.outcome === "BUDGET_EXHAUSTED").length,
  registryHolds: held.length,
  bodiesGraphFoundRegistryDoesNot: notInRegistry.length,
  maxDepthReached: Math.max(0, ...expanded.map((n) => n.depth)),
};

const out = {
  route: "wikipedia-government-graph",
  tier: "A",
  zip,
  state: stateName,
  seeds,
  walkedAt: AS_OF,
  note:
    "The graph AS WALKED. Nodes that returned nothing are KEPT — a route that " +
    "failed is as reusable as one that worked, and keeping it is what stops the " +
    "next state paying for the same discovery twice (RULING 63). Nothing here " +
    "is a fact this product renders: RULING 87 makes Wikipedia a DISCOVERY " +
    "source, and every name and site is a LEAD until its own source confirms it.",
  totals,
  bodiesGraphFoundRegistryDoesNot: notInRegistry.map((n) => ({
    title: n.resolvedTitle ?? n.title,
    kind: n.classification.kind,
    wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent((n.resolvedTitle ?? n.title).replace(/ /g, "_"))}`,
    officialSites: n.officialSites.map((l) => l.url),
    meetingLinks: n.meetingLinks.map((l) => l.url),
    discoveredFrom: n.discoveredFrom,
    depth: n.depth,
  })),
  nodes: [...nodes.values()].map((n) => ({
    ...n,
    wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent((n.resolvedTitle ?? n.title).replace(/ /g, "_"))}`,
  })),
  edges,
};

const outPath = join(process.cwd(), "data", "hunt", `wiki-graph-${zip}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log("");
for (const [k, v] of Object.entries(totals)) console.log(`  ${k.padEnd(34)} ${v}`);
console.log(`  written                            ${outPath}`);

if (expanded.length === 0) {
  console.error("ZERO nodes expanded — that is a FAILED crawl, not an empty graph.");
  process.exit(1);
}
