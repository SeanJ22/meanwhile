/**
 * `pnpm gov:directory` — OPEN A GOVERNMENT AND ASK WHAT GOVERNS INSIDE IT.
 * (2026-08-26, the descent-resume session. **RULING 93**, **RULING 183**.)
 *
 * ## The gap between two things that look the same
 *
 * ```
 * found a government URL
 * enumerated what governs inside that government
 * ```
 *
 * The tier descent does the first. It follows links, records what it found,
 * and moves on — so a county whose front page links its boards directory
 * contributes one edge and, if the budget runs out before that edge is walked,
 * nothing at all. The county's own **"Authorities, Boards and Commissions"**
 * page is the answer to "what governs inside Morris County", and reaching it
 * is a matter of which pass the budget happened to end on.
 *
 * This asks a government directly, by name, and records what it says into
 * canonical state as leads — so the adjudicator can then open each one and
 * promote the real bodies. It is RULING 93's hierarchy descent as a motion
 * rather than as a hope.
 *
 * ## What it produces, and what it does NOT
 *
 * Leads. `ENTITY_CANDIDATE`, every one, persisted in the run that found them
 * (RULING 181). **Nothing here promotes** — promotion needs a page fetched and
 * a control held, which is `pnpm leads:adjudicate-descent`'s job, and keeping
 * the two apart is what stops a directory of twenty-five links reading as
 * twenty-five bodies (RULING 183).
 *
 * The measured example: Morris County's boards directory serves 138 links, of
 * which 25 name something body-shaped and 3 of those 25 are the county's own
 * history pages — "Coat of Arms of Morris County" heads on the word "county".
 * A count of 138, or of 25, would have been wrong in two different directions.
 *
 * Usage:
 *   pnpm gov:directory --state nj --tier county --url https://…/Boards --dry
 *   pnpm gov:directory --state nj --tier county --url https://…/Boards
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { extractLinks, looksLikeBody } from "../lib/hunt/descent-walk.ts";
import { readsAsBodyName } from "../lib/hunt/entity-name.ts";
import { triageLead } from "../lib/hunt/lead-triage.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { recordCandidate } from "../lib/workstate/candidates.ts";
import { deriveCursor, edgeId, loadWorkstream, recordDiscovery, recordProcessed, saveWorkstream } from "../lib/workstate/frontier.ts";
import { flag, present, repeated } from "./cli-args.mts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();

const has = (n: string): boolean => present(process.argv, n);
const arg = (n: string): string | undefined => flag(process.argv, n);
const argAll = (n: string): string[] => repeated(process.argv, n);

async function main(): Promise<void> {
  const state = (arg("state") ?? "").trim().toLowerCase();
  const tier = (arg("tier") ?? "county").trim();
  const urls = argAll("url");
  const dry = has("dry");
  const stamp = today();

  if (!state || urls.length === 0) {
    throw new Error("pnpm gov:directory --state <code> --tier <tier> --url <directory url> [--url …]");
  }
  if (!existsSync(join(ROOT, "data", "workstate", `${state}.json`))) {
    throw new Error(`no canonical work state for ${state}`);
  }
  const w = loadWorkstream(ROOT, state);
  if (!w) throw new Error(`no canonical work state for ${state}`);

  const totals = { pages: 0, read: 0, links: 0, bodyShaped: 0, kept: 0, named: 0, newLeads: 0, alreadyKnown: 0 };
  const named: { name: string; url: string; isNew: boolean }[] = [];
  const refused: string[] = [];

  for (const url of urls) {
    totals.pages += 1;
    let text = "";
    let status = 0;
    try {
      const res = await politeGetText(url, { profile: "browser", accept: "text/html,*/*" });
      text = res.text;
      status = res.status;
      totals.read += 1;
    } catch (e) {
      /* A directory we could not open is a WALL on this route and is named as
       * one. It is not evidence about what governs inside this government. */
      refused.push(`${url} — ${(e as Error).message.slice(0, 110)}`);
      continue;
    }

    /* The directory itself is an edge, and it has now been walked. */
    const dirEdge = edgeId(state, tier, url, "government directory");
    if (!dry) {
      recordDiscovery(w, { state, tier, url, text: "government directory", parent: null, discoveredOn: stamp });
      recordProcessed(w, dirEdge, "INGESTED", stamp);
    }

    const links = extractLinks(text, url);
    totals.links += links.length;
    console.log(`HTTP ${status}  ${text.length} B  ${links.length} link(s)  ${url}`);

    for (const l of links) {
      if (!looksLikeBody(l).isBody) continue;
      totals.bodyShaped += 1;
      const t = triageLead({ text: l.text, url: l.url });
      if (!t.keep) continue;
      totals.kept += 1;
      const n = readsAsBodyName(l.text);
      if (!n.isBody) continue;
      totals.named += 1;
      if (dry) {
        named.push({ name: n.name, url: l.url, isNew: true });
        continue;
      }
      const { isNew } = recordCandidate(w, {
        state,
        tier,
        url: l.url,
        text: l.text,
        fromEdge: dirEdge,
        discoveredOn: stamp,
      });
      /* The link is an edge too — the body's own page is where its roster and
       * its agendas live, and that is the next question. */
      recordDiscovery(w, { state, tier, url: l.url, text: l.text, parent: dirEdge, discoveredOn: stamp });
      if (isNew) totals.newLeads += 1;
      else totals.alreadyKnown += 1;
      named.push({ name: n.name, url: l.url, isNew });
    }
  }

  if (!dry) {
    w.cursor = deriveCursor(w, state);
    saveWorkstream(ROOT, w);
  }

  console.log(`\n=== GOVERNMENT DIRECTORY WALK — ${state.toUpperCase()} / ${tier}${dry ? "  (DRY RUN)" : ""}`);
  console.log(`directories asked            ${totals.pages}`);
  console.log(`  opened                     ${totals.read}`);
  console.log(`  refused                    ${refused.length}   <- a wall on this route, never a fact about the government`);
  for (const r of refused) console.log(`      ${r}`);
  console.log(`links on them                ${totals.links}`);
  console.log(`  body-shaped                ${totals.bodyShaped}`);
  console.log(`  survived triage            ${totals.kept}`);
  console.log(`  NAMING A BODY              ${totals.named}`);
  console.log(`    new to canonical state   ${totals.newLeads}`);
  console.log(`    already a known lead     ${totals.alreadyKnown}`);
  console.log("");
  console.log(
    `  ${floorLine(
      totals.links > 0
        ? floored("named a body", "the links on these directories", totals.links, totals.named)
        : floored("named a body", "the links on these directories", 0, 0, "no directory could be opened"),
    )}`,
  );
  console.log("\nThese are LEADS. Promote them with: pnpm leads:adjudicate-descent --state " + state);
  if (named.length) {
    console.log("\n--- what the government says governs inside it ---");
    for (const n of named.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${n.isNew ? "NEW " : "    "} ${n.name.slice(0, 54).padEnd(56)} ${n.url.slice(0, 70)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
