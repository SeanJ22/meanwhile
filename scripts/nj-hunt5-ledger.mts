/**
 * **THE NJ HUNT 5 LEDGER — every close-out figure, READ rather than estimated.**
 * (NJ Hunt 5 close-out, 2026-08-22.)
 *
 * ```
 * pnpm nj5:ledger
 * ```
 *
 * The brief's standing rule: *write the report from measured values; every
 * close-out figure is read out of the repo or the database before the first
 * close-out commit; no estimates, no later corrections.* NJ Hunt 4 shipped
 * estimated headline numbers and had to correct them in a second commit. This is
 * the instrument that stops that happening again.
 *
 * **The two-numbers rule applies throughout** (D68). Everything this session
 * COLLECTED is not what a reader RENDERS, and the pair is stated rather than
 * one number standing in front of two measurements.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MANIFEST_ROUTES, MANIFEST_VERSION, tierCounts } from "../lib/hunt/branch-manifest.ts";

const ROOT = process.cwd();
// The trailing comma is required in a .mts file: <T> alone parses as JSX.
const read = <T,>(p: string): T | null =>
  existsSync(join(ROOT, p)) ? (JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T) : null;

const line = (label: string, value: unknown): void =>
  console.log(`  ${label.padEnd(46)} ${String(value)}`);

console.log("\nNJ HUNT 5 — THE LEDGER, read from the repo\n");

/* ── The manifest ───────────────────────────────────────────────────────── */
console.log("MANIFEST");
const tiers = tierCounts();
line("version", MANIFEST_VERSION);
line("routes, live", MANIFEST_ROUTES.filter((r) => r.retiredOn === undefined).length);
line("tier A · B · C", `${tiers.overall.A} · ${tiers.overall.B} · ${tiers.overall.C}`);
for (const [f, t] of Object.entries(tiers.byField)) {
  line(`  ${f}`, `A ${t.A} · B ${t.B} · C ${t.C}`);
}

/* ── The Wikipedia municipality walk ────────────────────────────────────── */
interface WikiOut {
  totals: Record<string, number>;
  citationHostMap: { host: string; citations: number }[];
  municipalities: {
    requested: string;
    title: string | null;
    missReason: string | null;
    mayor: { name: string } | null;
    council: { name: string }[];
    fromTemplates: { name: string; body: string | null }[];
    governingBody: { seats: number | null; form: string | null } | null;
    citationChecks: { person: string; verdict: string }[];
  }[];
}
const wiki = read<WikiOut>("data/states/nj/hunt/wikipedia-nj-morris.json");
console.log("\nWIKIPEDIA-MUNICIPALITY (Tier A) — Morris County");
if (wiki === null) {
  console.log("  NOT RUN");
} else {
  for (const [k, v] of Object.entries(wiki.totals)) line(k, v);
  const rate =
    wiki.totals.citationChecks > 0
      ? ((wiki.totals.confirmed / wiki.totals.citationChecks) * 100).toFixed(1)
      : "—";
  line("citation-confirmation rate", `${wiki.totals.confirmed} of ${wiki.totals.citationChecks} = ${rate}%`);

  // The three municipalities at 07866, which is the zip the brief is about.
  const ZIP = ["Rockaway Township, New Jersey", "Rockaway, New Jersey", "Denville, New Jersey"];
  const pairs = new Set<string>();
  let confirmedAtZip = 0;
  for (const m of wiki.municipalities) {
    if (!ZIP.includes(m.requested)) continue;
    const verdicts = new Map(m.citationChecks.map((c) => [c.person, c.verdict]));
    for (const p of [m.mayor, ...m.council, ...m.fromTemplates].filter(
      (x): x is { name: string; body?: string | null } => x !== null,
    )) {
      const key = `${p.name}|${("body" in p ? p.body : null) ?? ""}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      if (verdicts.get(p.name) === "CONFIRMED") confirmedAtZip++;
    }
  }
  line("07866 — distinct person/body pairs named", pairs.size);
  line("07866 — of those, citation CONFIRMED", confirmedAtZip);

  // The form-of-government PREDICTION against the roster actually parsed.
  let predicted = 0;
  let named = 0;
  let comparable = 0;
  for (const m of wiki.municipalities) {
    const seats = m.governingBody?.seats ?? null;
    if (seats === null || m.council.length === 0) continue;
    comparable++;
    predicted += seats;
    named += m.council.length;
  }
  line("form-of-government seats PREDICTED", `${predicted} across ${comparable} municipalities`);
  line("roster members NAMED in those same ones", named);
}

/* ── The government graph ───────────────────────────────────────────────── */
interface GraphOut {
  totals: Record<string, number>;
  nodes: { expanded: boolean; classification: { kind: string | null } }[];
}
const graph = read<GraphOut>("data/states/nj/hunt/wiki-graph-07866.json");
console.log("\nWIKIPEDIA-GOVERNMENT-GRAPH (Tier A) — seeded from 07866");
if (graph === null) {
  console.log("  NOT RUN");
} else {
  for (const [k, v] of Object.entries(graph.totals)) line(k, v);
  const byKind: Record<string, number> = {};
  for (const n of graph.nodes.filter((x) => x.expanded)) {
    const k = n.classification.kind ?? "SEED";
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  console.log("  entities by kind:");
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
}

/* ── The officials' own pages ───────────────────────────────────────────── */
interface OffOut {
  totals: Record<string, number>;
  municipalities: {
    municipality: string;
    officialsExpected: number;
    officialsFoundOnSite: number;
    contacts: { name: string; emails: string[]; phones: string[]; verifiedPageUrl: string | null }[];
  }[];
}
const off = read<OffOut>("data/states/nj/hunt/officials-contact-nj-morris.json");
console.log("\nBODY-ROSTER-PAGE for OFFICIALS (Tier B) — Morris County");
if (off === null) {
  console.log("  NOT RUN");
} else {
  for (const [k, v] of Object.entries(off.totals)) line(k, v);
  const rt = off.municipalities.find((m) => /Rockaway Township/.test(m.municipality));
  if (rt !== undefined) {
    line(
      "Rockaway Township (the subject municipality)",
      `${rt.officialsFoundOnSite} of ${rt.officialsExpected} named · ` +
        `${rt.contacts.filter((c) => c.emails.length > 0).length} emails · ` +
        `${rt.contacts.filter((c) => c.phones.length > 0).length} phones`,
    );
  }
}

/* ── The credentials ────────────────────────────────────────────────────── */
interface KeysOut {
  keys: { key: string; called: boolean; status: unknown; fieldsClosed: number; returned: string }[];
}
const keys = read<KeysOut>("data/hunt/api-keys-walk.json");
console.log("\nHELD CREDENTIALS (Tier A) — RULING 90 item 5");
if (keys === null) {
  console.log("  NOT RUN");
} else {
  let closed = 0;
  for (const k of keys.keys) {
    closed += k.fieldsClosed;
    console.log(
      `  ${k.key.padEnd(20)} called ${String(k.called).padEnd(5)} status ${String(k.status ?? "-").padEnd(5)} ` +
        `closed ${String(k.fieldsClosed).padStart(3)}  ${k.returned.slice(0, 62)}`,
    );
  }
  line("TOTAL owed fields closed from credentials", closed);
}

/* ── NJ ELEC ────────────────────────────────────────────────────────────── */
interface ElecOut {
  locationCodesOnPage: number;
  control: { rows: number; bytes: number };
  locations: { location: string; rows: unknown[]; indistinguishableFromControl: boolean }[];
}
const elec = read<ElecOut>("data/states/nj/hunt/nj-elec-2026.json");
console.log("\nFILING-CAMPAIGN-FINANCE-LOCAL — NJ ELEC (the largest NH71 route)");
if (elec === null) {
  console.log("  NOT RUN");
} else {
  line("location codes read from the page", elec.locationCodesOnPage);
  line("control rows (must be 0)", elec.control.rows);
  for (const l of elec.locations) {
    line(`  ${l.location}`, `${l.rows.length} filed entities`);
  }
}

/* ── The ballot, and what a reader actually gets ────────────────────────── */
interface Ballot {
  contests: { id: string }[];
  candidacies: { id: string }[];
}
const ballot = read<Ballot>("data/states/nj/ballot/nj-morris-2026.json");
const cards = read<{ cards: Record<string, unknown> }>("data/ballot/candidate-cards-2026.json");
const links = read<{ links: Record<string, unknown> }>("data/ballot/candidate-links-2026.json");
console.log("\nTHE BALLOT — collection against rendering (D68, stated as a pair)");
if (ballot !== null) {
  line("contests", ballot.contests.length);
  line("candidacies", ballot.candidacies.length);
  line(
    "candidacies with a card",
    Object.keys(cards?.cards ?? {}).filter((k) => k.startsWith("ballot-nj-morris")).length,
  );
  line(
    "candidacies with a link record",
    Object.keys(links?.links ?? {}).filter((k) => k.startsWith("ballot-nj-morris")).length,
  );
}

console.log("");
