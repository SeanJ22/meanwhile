import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { VotingSitesFile } from "./voting-sites.ts";

/**
 * The server half of B19 — reading the committed retrieval off disk.
 *
 * **TWO PROJECTIONS, DELIBERATELY SEPARATE**, the same split
 * `lib/coverage/states.ts` makes and for a sharper reason: the first cut put
 * this `readFileSync` in the module the voting-sites PANEL imports, and
 * `node:fs` went straight into the client graph. The dev server refused to
 * build the page at all — "the chunking context does not support external
 * modules (request: node:fs)" — which is the lucky version of this mistake.
 * The unlucky version type-checks, builds, and ships a filesystem shim to
 * every reader on a map that is already 75% of their initial JavaScript.
 *
 * So: everything a browser may touch lives in `./voting-sites.ts` — types,
 * the model sentences, the narrowing, the directions handoff — and the file
 * read lives here, where only the route and the scripts reach it.
 */

let cache: VotingSitesFile | null = null;

export function loadVotingSites(): VotingSitesFile {
  if (cache) return cache;
  cache = JSON.parse(
    readFileSync(join(process.cwd(), "data", "voting-sites.json"), "utf8"),
  ) as VotingSitesFile;
  return cache;
}
