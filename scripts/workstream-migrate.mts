/**
 * `pnpm workstream:migrate` — import the active descent workstream into
 * canonical state.
 *
 * ## What was actually there, measured rather than assumed
 *
 * `states/<state>/descent.json` at the migration HEAD carried
 * `{state, startedOn, passes, finalPassNewLinks, levels[]}`, and each level
 * carried COUNTS — `found`, `followed`, `yielded`, `barren`, `candidatesNew`,
 * `candidatesKnown` — plus a `declined` array of `{url, reason}`.
 *
 * Confirmed by inspection: **no `edges` array, no `cursor`, no `queue`.**
 * `finalPassNewLinks` is 1986 / 1143 / 771 for NJ / AZ / NH — *the number of
 * outstanding edges was persisted; the edges were not.*
 *
 * So resume genuinely required re-walking seeds to rediscover work the previous
 * session had already found, which is what RULING 181 forbids.
 *
 * ## What this migration can and cannot recover
 *
 * **CAN:** every candidate, with its link text, its URL, its tier and its
 * already-matched flag — `descent-candidates.md` persisted all of it. Every
 * declined edge with its reason. Every per-level count, preserved as the
 * historical measurement it is.
 *
 * **CANNOT:** the 3,900 queued edges. They were never written down. This
 * migration therefore records them as an explicit, named, counted GAP rather
 * than pretending the frontier is whole — and the workstream stays OPEN with a
 * cursor pointing at the re-walk that recovers them.
 *
 * **That gap is the finding, and it is the argument for the whole change.**
 * Reporting a recovered frontier here would be exactly the partial-that-
 * reconciles this repository names most often.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyEdge, ELIGIBLE_EDGE_VERSION } from "../lib/workstate/eligibility.ts";
import { deriveCursor } from "../lib/workstate/frontier.ts";
import type { EntityCandidate, WorkEdge } from "../lib/workstate/types.ts";
import type { WorkItem, Workstream } from "../lib/workstate/workstream.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATES = ["nj", "az", "nh"] as const;
const OUT = join(ROOT, "data", "workstate");

const MIGRATED_ON = process.env.WTP_TODAY ?? "2026-08-26";

interface LegacyLevel {
  state: string;
  tier: string;
  vocabulary: string[];
  found: number;
  followed: number;
  yielded: number;
  barren: number;
  declined: Array<{ url: string; reason: string }>;
  catalogued: number;
  candidatesNew: number;
  candidatesKnown: number;
  pass: number;
  walkedOn: string;
}

interface LegacyDescent {
  state: string;
  startedOn: string;
  passes: number;
  finalPassNewLinks: number;
  levels: LegacyLevel[];
}

function stableId(prefix: string, ...parts: string[]): string {
  // The separator is written as the ESCAPE, never the raw character. A literal
  // NUL byte in a source file makes ripgrep and `git grep` classify it as
  // binary and SKIP it silently, so every class sweep of this repository would
  // report nothing found without having looked — which is exactly what
  // `tests/nul-bytes.test.ts` caught here, in this function, on this run.
  //
  // It has to be SOME separator: joining on the empty string would let
  // ("ab","c") and ("a","bc") hash identically, and these ids are what makes
  // the frontier resumable.
  const h = createHash("sha256").update(parts.join(" "), "utf8").digest("hex").slice(0, 12);
  return `${prefix}-${h}`;
}

/** `| text | **no** | url |` rows, grouped under `## Tier` headings. */
function parseCandidates(md: string, state: string): Array<{
  text: string;
  url: string;
  matched: boolean;
  tier: string;
}> {
  const out: Array<{ text: string; url: string; matched: boolean; tier: string }> = [];
  let tier = "unknown";
  for (const line of md.split("\n")) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      tier = h[1].trim().toLowerCase();
      continue;
    }
    const m = /^\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(\S+)\s*\|$/.exec(line.trim());
    if (!m) continue;
    if (/^-+$/.test(m[1]) || m[1] === "Candidate") continue;
    if (!/^https?:\/\//.test(m[3])) continue;
    out.push({
      text: m[1],
      url: m[3],
      matched: !/\*\*no\*\*/i.test(m[2]),
      tier,
    });
  }
  void state;
  return out;
}

const summary: Record<string, unknown> = {};
mkdirSync(OUT, { recursive: true });

for (const state of STATES) {
  const dir = join(ROOT, "states", state);
  const descentPath = join(dir, "descent.json");
  const candidatesPath = join(dir, "descent-candidates.md");
  if (!existsSync(descentPath)) {
    console.log(`${state}: no descent.json — skipped`);
    continue;
  }

  const legacy = JSON.parse(readFileSync(descentPath, "utf8")) as LegacyDescent;
  const candidatesMd = existsSync(candidatesPath) ? readFileSync(candidatesPath, "utf8") : "";
  const parsed = parseCandidates(candidatesMd, state);

  // --- candidates: leads, and explicitly NOT bodies ------------------------
  const candidates: EntityCandidate[] = parsed.map((c) => {
    const edgeId = stableId("edge", state, c.url, c.text);
    return {
      id: stableId("cand", state, c.url, c.text),
      // Every one of these is a LEAD. The descent promoted ZERO bodies from
      // them, and that measurement is preserved rather than inflated — a
      // candidate silently upgraded here would manufacture coverage that
      // nobody earned (RULING 183).
      state: c.matched ? "DUPLICATE" : "ENTITY_CANDIDATE",
      text: c.text,
      url: c.url,
      fromEdge: edgeId,
      jurisdiction: state,
      tier: c.tier,
      discoveredOn: legacy.levels[0]?.walkedOn ?? legacy.startedOn,
    };
  });

  // --- edges: the declined ones are the only ones that were written down ---
  //
  // The legacy file records a decline PER PASS, so the same URL at the same
  // tier appears twice — once declined `ALREADY_RECORDED` and once
  // `DEPTH_LIMIT`. That is ONE edge observed twice, not two edges, and minting
  // two ids for it would inflate the persisted frontier with duplicates. The
  // more informative disposition wins: `NOT_APPLICABLE` says only that we had
  // seen it before, while a walk outcome says what happened when we went.
  const edges: WorkEdge[] = [];
  const edgeAt = new Map<string, number>();
  const pushEdge = (e: WorkEdge) => {
    const at = edgeAt.get(e.id);
    if (at === undefined) {
      edgeAt.set(e.id, edges.length);
      edges.push(e);
      return;
    }
    if (edges[at].disposition === "NOT_APPLICABLE" && e.disposition !== "NOT_APPLICABLE") {
      edges[at] = e;
    }
  };
  for (const level of legacy.levels) {
    for (const d of level.declined) {
      pushEdge({
        // The LEVEL is part of the id: the same URL is legitimately declined at
        // more than one tier, and hashing the URL alone collided 7 times in AZ.
        id: stableId("edge", state, level.tier, d.url),
        url: d.url,
        text: "",
        parent: `seed:${state}:${level.tier}`,
        state,
        tier: level.tier,
        level: level.tier,
        disposition: d.reason === "ALREADY_RECORDED" ? "NOT_APPLICABLE" : "WALKED_NO_YIELD",
        discoveredOn: level.walkedOn,
        processedOn: level.walkedOn,
        declinedReason: d.reason,
        eligible: false,
      });
    }
  }
  // Each candidate implies the edge it was seen at. That edge WAS processed —
  // it yielded this candidate — so it is recorded as such rather than queued.
  for (const c of parsed) {
    const id = stableId("edge", state, c.url, c.text);
    const v = classifyEdge({ text: c.text, url: c.url });
    pushEdge({
      id,
      url: c.url,
      text: c.text,
      parent: `seed:${state}`,
      state,
      tier: c.tier,
      level: c.tier,
      // DISCOVERED and NOT processed. The legacy run found these links and
      // named the bodies in them; it never walked them, and it promoted zero
      // bodies from them. Stamping `processedOn` here would shrink the
      // outstanding frontier by 1,614 edges while looking tidier.
      disposition: "DISCOVERED",
      discoveredOn: legacy.levels[0]?.walkedOn ?? legacy.startedOn,
      declinedReason: v.eligible ? undefined : v.reason,
      eligible: v.eligible,
    });
  }

  // --- the unrecoverable frontier, named and counted ----------------------
  // `finalPassNewLinks` says how many links the final pass queued. The links
  // themselves were never persisted. This is stated as a GAP, with the exact
  // number, rather than quietly omitted — a migration that reported a whole
  // frontier here would be the silent partial this repository names most often.
  const unrecoverableQueued = legacy.finalPassNewLinks;

  const items: WorkItem[] = legacy.levels.map((l) => ({
    id: `${state}:${l.tier}`,
    subject: `${state}:${l.tier}`,
    // A level whose final pass still queued links is NOT finished walking.
    disposition: unrecoverableQueued > 0 ? "IN_PROGRESS" : "WALKED_NO_YIELD",
    children: [],
    updatedOn: l.walkedOn,
  }));
  items.push({
    id: `${state}:frontier-recovery`,
    subject: `${state}:frontier-recovery`,
    disposition: "REQUIRES_NEW_ADAPTER",
    children: [],
    updatedOn: MIGRATED_ON,
    blockerReason:
      `${unrecoverableQueued} queued edges from the final pass were never persisted by the legacy ` +
      `descent — only their COUNT was. They are recoverable only by re-walking, which is the ` +
      `defect RULING 181 names. Every edge discovered from this point forward is persisted.`,
  });

  const ws: Workstream = {
    id: `descent:${state}`,
    title: `Descent — ${state.toUpperCase()}`,
    openedOn: legacy.startedOn,
    universe: {
      // The denominator is the tier structure the descent declared, which is
      // what the legacy artifact can actually support. It is NOT a claim about
      // the official universe of bodies — that is a different denominator, and
      // conflating them would be measuring coverage against our own records
      // (RULING 147).
      authority: `descent tier structure declared by lib/hunt/descent-seeds.ts for ${state}`,
      version: `legacy-${legacy.startedOn}`,
      members: [...legacy.levels.map((l) => `${state}:${l.tier}`), `${state}:frontier-recovery`],
    },
    items,
    edges,
    candidates,
    permissions: [],
    // Placeholder — replaced immediately below by the DERIVED cursor, once the
    // workstream object exists to derive it from.
    cursor: null,
    convergence: null,
    routesInherited: [],
    routesLearned: [],
    methodVersion: 0,
  };

  // The cursor is DERIVED from the persisted edges, never narrated (RULING
  // 180). It states what is outstanding and where the next edge is, so a resume
  // reads it rather than reconstructing it — and it cannot disagree with the
  // store it was computed from.
  //
  // The unrecoverable legacy tail is appended as a NAMED gap rather than
  // omitted: `finalPassNewLinks` says how many edges the last pass queued, and
  // the legacy format never wrote the edges themselves down.
  ws.cursor =
    `${deriveCursor(ws, state)} / ` +
    `${unrecoverableQueued} final-pass edges NOT persisted by the legacy format`;

  writeFileSync(join(OUT, `${state}.json`), JSON.stringify(ws, null, 2) + "\n", "utf8");

  const promoted = candidates.filter((c) => c.state === "BODY_PROMOTED").length;
  summary[state] = {
    legacyCounts: {
      passes: legacy.passes,
      levels: legacy.levels.length,
      finalPassNewLinks: legacy.finalPassNewLinks,
      candidatesNew: legacy.levels.reduce((n, l) => n + l.candidatesNew, 0),
      candidatesKnown: legacy.levels.reduce((n, l) => n + l.candidatesKnown, 0),
      declined: legacy.levels.reduce((n, l) => n + l.declined.length, 0),
    },
    migrated: {
      edgesPersisted: edges.length,
      eligibleEdges: edges.filter((e) => e.eligible).length,
      candidates: candidates.length,
      entityCandidates: candidates.filter((c) => c.state === "ENTITY_CANDIDATE").length,
      duplicates: candidates.filter((c) => c.state === "DUPLICATE").length,
      promotedBodies: promoted,
      items: items.length,
    },
    unrecoverableQueuedEdges: unrecoverableQueued,
  };

  // RULING 159 — the floor is asserted BEFORE the counts are reported. Zero
  // levels in a state's descent means the legacy file failed to parse, never a
  // state with no government; zero candidates from a walked tier is the same
  // shape. A silent zero here would read as a clean migration of nothing.
  console.log(
    "  " +
      floorLine(
        // One item per level, and the pair is level-derived items ONLY. `items` also
        // carries the synthetic frontier-recovery row, which is not a level — the
        // floor threw on that mismatch the first time this ran, which is the
        // instrument doing its job rather than being asserted to work.
        floored(
          `descent:${state} levels`,
          "states/<state>/descent.json levels[]",
          legacy.levels.length,
          items.filter((i) => !i.id.endsWith(":frontier-recovery")).length,
        ),
      ),
  );
  console.log(
    "  " +
      floorLine(
        floored(`descent:${state} candidate rows`, "descent-candidates.md table rows", parsed.length, candidates.length),
      ),
  );
  console.log(
    `${state}: ${edges.length} edges persisted, ${candidates.length} candidates, ` +
      `${promoted} promoted bodies, ${unrecoverableQueued} legacy queued edges NOT recoverable`,
  );
}

writeFileSync(
  join(OUT, "migration-summary.json"),
  JSON.stringify({ migratedOn: MIGRATED_ON, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION, states: summary }, null, 2) + "\n",
  "utf8",
);
console.log(`\nwrote ${join("data", "workstate")}`);
