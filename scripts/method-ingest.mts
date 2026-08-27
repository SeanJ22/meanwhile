/**
 * `pnpm method:ingest` — bring the existing branch manifest into the cumulative
 * method store without resetting anything it has learned.
 *
 * RULING 63 and the remediation brief both say the same thing: **do not reset
 * the project's learned discovery system while improving its architecture.**
 * `lib/hunt/branch-manifest.ts` holds 62 routes with real reasoning attached,
 * `expectedToTravel` prose on 63 fields, sub-branches, tiers, and a
 * `MANIFEST_VERSION` of `v7`. All of it survives.
 *
 * What this adds is the TYPED portability class beside the prose, which is what
 * makes two questions answerable mechanically for the first time: which routes
 * apply to a jurisdiction we have never touched, and which prior conclusions a
 * newly learned route reopens.
 *
 * **Every ingested route defaults to `UNKNOWN` portability.** That is not a
 * gap to be filled in later by guessing — RULING 178 says do not generalize
 * farther than the evidence supports, and the prose in the manifest is
 * jurisdictional evidence about one shape, not a portability proof. `UNKNOWN`
 * still INHERITS to every new jurisdiction; it is simply marked speculative so
 * a report can never claim the route was known to fit.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MANIFEST_VERSION, MANIFEST_ROUTES } from "../lib/hunt/branch-manifest.ts";
import type { MethodKnowledge, MethodRoute } from "../lib/method/knowledge.ts";
import { unknownApplicability, type PortabilityClass } from "../lib/method/portability.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = join(ROOT, "data", "method", "knowledge.json");
const TODAY = process.env.WTP_TODAY ?? "2026-08-26";

/**
 * Every ingested route enters at `UNKNOWN` portability. All of them.
 *
 * **The first version of this file read a portability class out of the prose
 * and produced 17 `NATIONWIDE` routes. That was wrong, and the field's own name
 * says why: `expectedToTravel`.** It records what this project EXPECTS about a
 * route's reach — an honest expectation, often carrying real doubt — and an
 * expectation is not evidence. RULING 178 says do not generalize farther than
 * the evidence supports, and the manifest holds no per-jurisdiction outcome
 * records at all, so there was nothing behind any of those 17 claims.
 *
 * Reading an expectation as a proof would have shipped exactly the RULING 60
 * failure the class was built to prevent: the route that reaches a Newbury
 * board declared nationwide, then walked against a borough in Alaska, an
 * unincorporated county in Arizona, or a parish in Louisiana.
 *
 * So portability is EARNED from recorded outcomes, and the prose is preserved
 * verbatim in `note` where it keeps being useful as reasoning. `UNKNOWN` still
 * inherits to every new jurisdiction — it is marked speculative, never
 * withheld.
 */
function readPortability(prose: string): { klass: PortabilityClass; note: string } {
  return { klass: "UNKNOWN", note: prose };
}

interface RawRoute {
  id: string;
  what: string;
  how: string;
  through: string;
  tier?: string;
  fields?: readonly string[];
  expectedToTravel?: string;
  subBranches?: readonly { where: string; on: string; instead: string }[];
  retiredOn?: string;
  retiredBecause?: string;
}

const raw = MANIFEST_ROUTES as unknown as RawRoute[];

const routes: MethodRoute[] = raw.map((r) => {
  const { klass, note } = readPortability(r.expectedToTravel ?? "");
  const app = unknownApplicability(note);
  app.portability = klass;
  return {
    id: r.id,
    title: r.what,
    // The manifest's Tier A predates RULING 166's A0/A1 split. An ingested
    // Tier A route lands at A1 — third-party compilations — because A0 is the
    // BODY'S OWN publication, and claiming a route reads the body's own source
    // when nothing recorded that would be inventing provenance.
    tier: r.tier === "A" ? "A1" : ((r.tier as MethodRoute["tier"]) ?? "C"),
    fields: [...(r.fields ?? [])],
    applicability: app,
    outcomes: [],
    // The legacy sub-branch shape is {where, on, instead}. Its `on` is the
    // date the route failed there and `instead` is what replaced it — mapped
    // rather than reinterpreted, so no failure record loses its jurisdiction
    // or its date (RULING 60).
    subBranches: (r.subBranches ?? []).map((sb) => ({
      jurisdiction: sb.where,
      failedOn: sb.on,
      reason: `inherited route failed here; replaced by: ${sb.instead}`,
      replacedBy: sb.instead,
    })),
    origin: `lib/hunt/branch-manifest.ts (${MANIFEST_VERSION})`,
    // Every ingested route enters at version 0 — BEFORE anything learned after
    // the migration. That is what lets a route learned at v1 reopen a
    // conclusion earned under the legacy manifest.
    learnedAtVersion: 0,
    learnedOn: null,
    retiredOn: r.retiredOn,
    retiredReason: r.retiredBecause,
  };
});

const knowledge: MethodKnowledge = { version: 0, updatedOn: TODAY, routes };

mkdirSync(dirname(STORE), { recursive: true });
writeFileSync(STORE, JSON.stringify(knowledge, null, 2) + "\n", "utf8");

const byPortability: Record<string, number> = {};
for (const r of routes) {
  byPortability[r.applicability.portability] = (byPortability[r.applicability.portability] ?? 0) + 1;
}
const byTier: Record<string, number> = {};
for (const r of routes) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;

// RULING 159 — zero routes ingested means the manifest import read nothing.
// That is the silent-zero shape this repository names most often.
console.log(floorLine(floored("method:ingest routes", "lib/hunt/branch-manifest.ts MANIFEST_ROUTES", raw.length, routes.length)));

console.log(`legacy manifest version   ${MANIFEST_VERSION}`);
console.log(`routes ingested           ${routes.length}`);
console.log(`with applicability state  ${routes.filter((r) => r.applicability).length}`);
console.log(`by portability            ${JSON.stringify(byPortability)}`);
console.log(`by tier                   ${JSON.stringify(byTier)}`);
console.log(`sub-branches preserved    ${routes.reduce((n, r) => n + r.subBranches.length, 0)}`);
console.log(`method version            ${knowledge.version}`);
console.log(`\nNO ROUTE CAP EXISTS. ${routes.length} is what the project knows now, never what exists.`);
void readFileSync;
