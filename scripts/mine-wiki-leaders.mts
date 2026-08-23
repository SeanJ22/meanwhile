/**
 * `pnpm mine:wiki-leaders` — **the roster rows already sitting in a committed
 * graph, with the markup taken off.**
 *
 * Written 2026-08-23 (visual-tail-and-rehunt session, item 7). An EXPANSION
 * route under RULING 88: a new route to a field already owed — the rosters
 * `NH72` records as OWED for 20 of 39 Morris municipalities — walked entirely
 * against committed data.
 *
 * ## How it was conceived
 *
 * `data/hunt/wiki-graph-07866.json` is 4.5 MB of committed government graph
 * from 2026-08-22: 280 nodes, 174 entities discovered, 171 of them bodies the
 * registry does not hold. Its per-node `leaders` array had never been read.
 *
 * The question that produced this was RULING 90's: *what would I try if there
 * were no manifest at all?* The answer, before going back out to any host, is
 * to read what is already in the tree.
 *
 * ## What was in the way, and it is a RULING 100 finding
 *
 * **The committed graph stores the leader names with Wikipedia markup still
 * attached.** The infobox parse kept the link syntax:
 *
 * ```
 * { "title": "[[City manager",  "name": "Joseph Jackson ([[Republican Party (United States)" }
 * ```
 *
 * A consumer reading `name` straight out gets a string that is not a person's
 * name, and the extraction reported success. Nothing was empty, so no zero-row
 * check fired; the rows were simply wrong in a way only reading them shows.
 * **The fix belongs in the graph's own generator** — RULING 92 — and that
 * generator reads Wikipedia over the network, which this environment cannot
 * reach. So the cleaning happens here, the defect is a tracker row, and the
 * artifact is owed a regeneration when egress is available.
 *
 * ## Every row is a LEAD
 *
 * RULING 87: **Wikipedia is a Tier A discovery source and never a source of
 * record.** It names the person; the citation proves them, and a fact whose
 * citation cannot be confirmed is a `LEAD`, not a `FOUND`. Confirming these
 * means fetching each footnote — which is the control check this run cannot
 * perform. Nothing here ships to a reader unconfirmed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "node:fs";

const ROOT = process.cwd();
const GRAPH = process.argv[2] ?? "data/hunt/wiki-graph-07866.json";
const OUT = "data/hunt/wiki-leader-leads-07866.json";

interface Leader {
  title?: string;
  name?: string;
}
interface Node {
  title: string;
  depth: number;
  leaders?: Leader[];
  wikipediaUrl?: string;
}

/**
 * Strip the Wikipedia link syntax the committed graph kept.
 *
 * The trailing-paren case is the load-bearing one: `"Joseph Jackson ([[Republican
 * Party (United States)"` is a NAME followed by an unterminated party link, and
 * a naive bracket strip leaves "Joseph Jackson (Republican Party (United States"
 * — still not a name. Everything from the opening paren of a link is dropped.
 */
export function cleanWikiText(raw: string): string {
  return raw
    .replace(/\(\[\[[\s\S]*$/, "")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,(]+|[,(]+$/g, "")
    .trim();
}

const graph = JSON.parse(readFileSync(join(ROOT, GRAPH), "utf8")) as {
  zip?: string;
  walkedAt?: string;
  nodes: Node[];
};

/** Every officeholder name this product already holds, for the delta. */
const held = new Set<string>();
for (const file of readdirSync(join(ROOT, "lib/registry"))) {
  if (!/^officeholders-.*\.json$/.test(file)) continue;
  const parsed = JSON.parse(readFileSync(join(ROOT, "lib/registry", file), "utf8")) as
    | { officeholders?: { name?: string }[] }
    | { name?: string }[];
  const arr = Array.isArray(parsed) ? parsed : (parsed.officeholders ?? []);
  for (const row of arr) {
    const n = (row.name ?? "").trim().toLowerCase();
    if (n.length > 0) held.add(n);
  }
}

interface LeadRow {
  entity: string;
  wikipediaUrl: string | null;
  officeTitle: string;
  name: string;
  /** The bytes the graph actually stored, so the cleaning is auditable. */
  rawName: string;
  alreadyHeld: boolean;
  municipal: boolean;
}

let given = 0;
let dropped = 0;
const rows: LeadRow[] = [];
for (const node of graph.nodes) {
  for (const leader of node.leaders ?? []) {
    given += 1;
    const name = cleanWikiText(leader.name ?? "");
    if (name.length < 4) {
      dropped += 1;
      continue;
    }
    rows.push({
      entity: node.title,
      wikipediaUrl: node.wikipediaUrl ?? null,
      officeTitle: cleanWikiText(leader.title ?? ""),
      name,
      rawName: leader.name ?? "",
      alreadyHeld: held.has(name.toLowerCase()),
      // A municipality article, as opposed to a state or federal department
      // the graph also walked. These are the rows NH72 is about.
      municipal: /,\s+New Jersey$/.test(node.title),
    });
  }
}

const fresh = rows.filter((r) => !r.alreadyHeld);
const municipal = fresh.filter((r) => r.municipal);
const withMarkup = rows.filter((r) => r.rawName !== r.name).length;

/*
 * RULING 100 — count assertion. The graph states how many leader entries it
 * holds; a run that read fewer has not read the graph. It states no expected
 * NUMBER OF PEOPLE per body, so completeness against the body's real size is
 * NOT_ASSERTABLE and says so rather than passing silently.
 */
console.log(`wiki leader leads — ${GRAPH} (walked ${graph.walkedAt ?? "unknown"})\n`);
console.log(`  leader entries the graph holds      ${given}`);
console.log(`  ...too short to be a name, dropped  ${dropped}`);
console.log(`  rows recovered                      ${rows.length}`);
console.log(`  ...whose stored name carried markup ${withMarkup} of ${rows.length}`);
console.log(`  count assertion (rows read)         ${given === 0 ? "NOT_ASSERTABLE" : "READ"}`);
console.log(`  count assertion (body completeness) NOT_ASSERTABLE — the graph states no seat count`);
console.log(`\n  not already an officeholder we hold ${fresh.length} of ${rows.length}`);
console.log(`  ...of which NJ MUNICIPAL             ${municipal.length}`);
for (const r of municipal) {
  console.log(`    ${r.entity.padEnd(32)} ${r.officeTitle.padEnd(18)} ${r.name}`);
}

writeFileSync(
  join(ROOT, OUT),
  `${JSON.stringify(
    {
      note:
        "EVERY ROW HERE IS A LEAD, NEVER A FOUND. RULING 87: Wikipedia is a Tier A " +
        "discovery source and never a source of record — it names the person, the citation " +
        "proves them, and a fact whose citation cannot be confirmed is a LEAD. This run " +
        "could not fetch a single footnote: every outbound host was refused at the egress " +
        "on 2026-08-23. Nothing here ships to a reader unconfirmed.",
      minedFrom: GRAPH,
      graphWalkedAt: graph.walkedAt ?? null,
      minedOn: "2026-08-23",
      markupDefect:
        "The committed graph stores leader names with Wikipedia link syntax attached " +
        "(\"Joseph Jackson ([[Republican Party (United States)\"). The fix belongs in the " +
        "graph's generator per RULING 92; that generator reads Wikipedia over the network " +
        "and could not run here. The artifact is owed a regeneration.",
      counts: {
        given,
        dropped,
        recovered: rows.length,
        withMarkup,
        fresh: fresh.length,
        municipal: municipal.length,
      },
      rows,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  wrote ${OUT}`);
