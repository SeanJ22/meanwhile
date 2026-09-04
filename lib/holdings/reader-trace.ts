import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ROSTER_FILES } from "../coverage/artifacts.ts";
import { rosterPath } from "./runtime-paths.ts";

export interface ReaderTraceRequirement { route: string; loader: string; files: string[] }
/** Input contracts, independently checked against Next's emitted deployment manifests. */
export function readerTraceRequirements(root: string): ReaderTraceRequirement[] {
  const { globSync } = fs as typeof fs & { globSync(pattern: string, options: { cwd: string }): string[] };
  const paths = (pattern: string) => [...globSync(pattern, { cwd: root })].map((p) => p.replaceAll("\\", "/")).sort();
  const resolver = "data/derived/resolver-geometry.json";
  const geometry = JSON.parse(readFileSync(join(root, resolver), "utf8")) as { files: string[] };
  const registry = [resolver, ...geometry.files, ...ROSTER_FILES.map(rosterPath), "lib/registry/registry.json", "lib/registry/official-photos.json", "data/states/az/geo/body-territories.geojson"];
  const money = paths("data/states/*/funding/state-money-??-????.json");
  if (money.length === 0 || geometry.files.length === 0) throw new Error("Reader trace denominator is empty");
  const ballot = ["data/states/az/ballot/az-pima-2026.json", "data/states/nj/ballot/nj-morris-2026.json", "data/states/nh/ballot/nh-merrimack-2026.json", "data/states/az/ballot/az-general-lineup-2026.json", "data/ballot/candidate-cards-2026.json", "data/ballot/candidate-links-2026.json"];
  const identity = ["data/states/az/identity/az-2026-candidate-registry.json", "data/states/az/identity/az-2026-certified-lineup-reconciliation.json"];
  const corpus = ["data/candidates/corpus-2026.json", "data/corpus/statements.json"];
  const votes = ["data/votes/votes-snapshot.json", "data/votes/state-votes-snapshot.json", "data/votes/key-votes-snapshot.json", "data/votes/key-vote-positions.json"];
  const outcome = ["data/states/az/outcomes/legistar-outcomes.json"];
  return [
    ...["api/meetings/route", "api/representation/[...division]/route", "api/votes/route", "api/voting-sites/route", "api/ask/grounded/route", "ballot/page", "about-area/page"].map((route) => ({ route, loader: "lib/registry/server.ts", files: registry })),
    ...["ballot/page", "api/funding/[target]/route", "api/ask/grounded/route"].map((route) => ({ route, loader: "lib/funding/campaign-money.ts", files: [...money, ...identity, ...ROSTER_FILES.map(rosterPath), "data/fec/fec-2026.json"] })),
    ...["ballot/page", "api/ask/grounded/route"].map((route) => ({ route, loader: "lib/ballot/registry.ts", files: [...ballot, "data/derived/zip-division-ids.json"] })),
    ...["api/meetings/route", "api/agenda/route", "api/ask/grounded/route", "api/ask/agenda/route"].map((route) => ({ route, loader: "lib/meetings/snapshot.ts", files: ["data/meetings-snapshot.json"] })),
    ...["api/agenda/route", "api/ask/grounded/route"].map((route) => ({ route, loader: "lib/outcomes/store.ts", files: outcome })),
    ...["api/positions/[subject]/[topic]/route", "api/ask/grounded/route"].map((route) => ({ route, loader: "lib/corpus/unified.ts", files: corpus })),
    { route: "api/votes/route", loader: "lib/votes/snapshot.ts", files: votes },
    { route: "api/ask/grounded/route", loader: "lib/ask/votes.ts", files: votes },
    ...["api/directory/route", "ballot/page"].map((route) => ({ route, loader: "lib/officials/directory.ts", files: ["data/congress-legislators/directory.json"] })),
    { route: "api/voting-sites/route", loader: "lib/ballot/voting-sites-server.ts", files: ["data/voting-sites.json"] },
    { route: "ballot/page", loader: "lib/ballot/seat-holders.ts", files: ["data/states/nh/hunt/nh-gencourt-members.json"] },
    { route: "api/profile/[subject]/route", loader: "lib/sources/prl/snapshot.ts", files: ["data/prl/prl-profiles.json"] },
    ...["api/official-actions/[subject]/route", "api/ask/grounded/route"].map((route) => ({ route, loader: "lib/officials/executive-actions.ts", files: ["data/states/az/officials/az-governor-actions.json", ...identity, ...ROSTER_FILES.map(rosterPath)] })),
    ...["ballot/page", "api/ask/grounded/route"].map((route) => ({ route, loader: "lib/ballot/candidate-contacts.ts", files: ["data/states/nj/ballot/nj-morris-2026-contacts.json"] })),
  ];
}

export function missingReaderTraceFiles(expected: readonly string[], actual: ReadonlySet<string>): string[] {
  return expected.filter((file) => !actual.has(file));
}

export function checkReaderTraces(root: string): { routes: number; requirements: number; files: number; failures: string[] } {
  const requirements = readerTraceRequirements(root);
  const failures: string[] = [];
  for (const requirement of requirements) {
    const tracePath = join(root, ".next/server/app", `${requirement.route}.js.nft.json`);
    if (!existsSync(tracePath)) { failures.push(`Missing production trace: ${requirement.route}`); continue; }
    const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { files: string[] };
    const actual = new Set(trace.files.map((file) => relative(root, resolve(dirname(tracePath), file)).replaceAll("\\", "/")));
    for (const missing of missingReaderTraceFiles(requirement.files, actual)) failures.push(`${requirement.route}: ${requirement.loader} cannot read untraced ${missing}`);
  }
  return { routes: new Set(requirements.map((r) => r.route)).size, requirements: requirements.length, files: new Set(requirements.flatMap((r) => r.files)).size, failures };
}
