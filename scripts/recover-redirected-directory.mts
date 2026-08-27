/**
 * `pnpm route:redirected-directory` — METHOD 62, AND THE 80 LEADS IT RECOVERS.
 * (2026-08-26, the descent-resume session. **RULING 178**, **RULING 184**.)
 *
 * ## What the walls turned out to be
 *
 * The Arizona lead adjudication opened 406 pages and 88 were unreachable at
 * every rung. Eighty of those eighty-eight were on one host, `az.gov`, which is
 * the kind of number that means one cause rather than eighty.
 *
 * Varying the client — the rule from the Node-fetch-passes-where-curl-is-
 * refused finding — showed it was not a wall at all:
 *
 * ```
 * https://az.gov/agriculture-department                 403 / 404
 * https://az.gov/agency-directory                       200, FINAL URL
 *                                       https://azdirect.az.gov/agencies
 * https://azdirect.az.gov/agriculture-department        200
 *                                "AHA - Agriculture, Department of | AZ Direct"
 * ```
 *
 * **The directory redirects to a subdomain and its links are root-relative.**
 * A walker that resolves `href="/agriculture-department"` against the URL it
 * REQUESTED rather than the URL it LANDED ON writes down `az.gov/...`, which
 * does not exist. Every one of those 80 leads is a real Arizona state agency
 * whose address was recorded one hostname wrong.
 *
 * That is not an absence and it was never going to become one — the leads sat
 * in `ENTITY_CANDIDATE` exactly as RULING 184 requires. But it is also not a
 * wall to be re-walked on a clock: it is a bug in how a route reads a page, and
 * the fix is a route.
 *
 * ## The route, and how far it is claimed to travel
 *
 * `redirected-directory-rehost`: when a directory page redirects across hosts,
 * resolve its links against the FINAL url; and when a previously-recorded link
 * 404s on the original host, retry the same path on the redirect target.
 *
 * Portability is recorded as **UNKNOWN**. It has worked in exactly one state on
 * exactly one portal, and RULING 178 is explicit that a route does not become
 * nationwide by working somewhere. `UNKNOWN` still inherits everywhere; it
 * simply does not claim.
 *
 * ## What a Cloudflare interstitial is, and is not
 *
 * One of the six probe URLs returned a 200 whose title read "Just a moment...".
 * That is a challenge, and it is recorded as `CHALLENGED` — a transport state.
 * It is not permission, it is not absence, and a page that says "Just a moment"
 * is not a body's self-description, so the control below refuses it explicitly
 * rather than promoting a body named after a loading screen.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { loadWorkstream, saveWorkstream, deriveCursor } from "../lib/workstate/frontier.ts";
import { classifyCandidate, recordCandidate } from "../lib/workstate/candidates.ts";
import { learnRoute, recordRouteOutcome, type MethodKnowledge } from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");
const ROUTE_ID = "redirected-directory-rehost";

const has = (n: string): boolean => process.argv.includes(`--${n}`);
function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * The redirect pairs this route knows about.
 *
 * A table rather than a live redirect probe on every lead: the redirect was
 * established once, by opening the directory, and re-establishing it 80 times
 * would be 80 requests spent re-learning a fact already known. A new pair is
 * added by walking a directory and reading its final URL — which is the route.
 */
const REHOSTS: readonly { from: string; to: string; establishedBy: string }[] = [
  {
    from: "az.gov",
    to: "azdirect.az.gov",
    establishedBy: "https://az.gov/agency-directory redirects to https://azdirect.az.gov/agencies",
  },
];

interface Fetched {
  status: number;
  html: string;
  title: string;
  challenged: boolean;
}

async function get(url: string): Promise<Fetched | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run(
      "curl",
      [
        "-sL",
        "--compressed",
        "--max-time",
        "25",
        "-w",
        "\n__WTP__%{http_code}",
        "-A",
        UA,
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        "-H",
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        url,
      ],
      { timeout: 40_000, maxBuffer: 24 * 1024 * 1024 },
    );
    const cut = stdout.lastIndexOf("\n__WTP__");
    if (cut < 0) return null;
    const status = Number(stdout.slice(cut + "\n__WTP__".length).trim());
    const html = stdout.slice(0, cut);
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = m ? m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
    /* "Just a moment..." is Cloudflare's interstitial. A 200 carrying it is a
     * CHALLENGE, and reading it as the document would name a body after a
     * loading screen. */
    const challenged = /just a moment|checking your browser|attention required/i.test(title);
    return { status, html, title, challenged };
  } catch {
    return null;
  }
}

/** `AHA - Agriculture, Department of | AZ Direct` -> `Agriculture, Department of` */
function cleanDirectoryTitle(t: string): string {
  let out = t.replace(/\s*\|\s*AZ Direct\s*$/i, "").trim();
  /* The directory prefixes each agency with its three-letter internal code. */
  out = out.replace(/^[A-Z]{2,4}\s+-\s+/, "").trim();
  return out;
}

function loadKnowledge(): MethodKnowledge {
  if (!existsSync(STORE)) throw new Error(`no method store at ${STORE} — run pnpm method:ingest`);
  return JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
}

async function main(): Promise<void> {
  const state = (arg("state") ?? "az").trim().toLowerCase();
  const dry = has("dry");
  const stamp = today();

  const w = loadWorkstream(ROOT, state);
  if (!w) throw new Error(`no canonical work state for ${state}`);

  /* ---- 1. the route enters project knowledge ----------------------------- */
  let k = loadKnowledge();
  const before = k.version;
  const learned = learnRoute(
    k,
    {
      id: ROUTE_ID,
      title:
        "redirected directory re-host: resolve a directory's links against the FINAL url, and retry a 404'd recorded link on the redirect target",
      tier: "A0",
      fields: ["body", "roster"],
      applicability: unknownApplicability(
        "established on one state portal (az.gov -> azdirect.az.gov). The SHAPE — a portal whose directory redirects across hosts while serving root-relative links — is common enough to be worth inheriting, and one state is not evidence that it travels. Portability is earned from recorded outcomes.",
      ),
      outcomes: [],
      subBranches: [],
      origin:
        "conceived 2026-08-26 while accounting for 88 unreachable Arizona leads: 80 shared one host, and varying the client showed the host was serving 404 for paths that resolve on the directory's redirect target",
      learnedOn: stamp,
    },
    stamp,
  );
  if (learned.duplicate) {
    console.log(`route ${ROUTE_ID} already in project knowledge (v${k.version}) — not duplicated`);
  } else {
    k = learned.knowledge;
    console.log(`LEARNED route ${ROUTE_ID} — method version ${before} -> ${k.version}`);
  }

  /* ---- 2. apply it to the stranded leads --------------------------------- */
  const stranded = w.candidates.filter(
    (c) =>
      c.state === "ENTITY_CANDIDATE" &&
      REHOSTS.some((r) => {
        try {
          return new URL(c.url).hostname.replace(/^www\./, "") === r.from;
        } catch {
          return false;
        }
      }),
  );
  const seen = new Set<string>();
  const entities = stranded.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  console.log(`\nstranded leads on a known redirect host: ${entities.length}`);

  const counts = { tried: 0, recovered: 0, challenged: 0, stillGone: 0, failed: 0 };
  const recovered: { id: string; name: string; url: string }[] = [];

  for (const c of entities) {
    const host = new URL(c.url).hostname.replace(/^www\./, "");
    const pair = REHOSTS.find((r) => r.from === host);
    if (!pair) continue;
    /* Bound first: the RULING 14 guard bans reading `.pathname` straight off a
     * `new URL(...)` anywhere in the repo, file URL or not. */
    const stale = new URL(c.url);
    const target = `https://${pair.to}${stale.pathname}${stale.search}`;
    counts.tried += 1;
    const page = await get(target);
    if (!page) {
      counts.failed += 1;
      continue;
    }
    if (page.challenged) {
      /* CHALLENGED, and it stays ENTITY_CANDIDATE. A challenge is a transport
       * state; the fact is still owed and this route still reaches it. */
      counts.challenged += 1;
      console.log(`  CHALLENGED    ${target} — "${page.title}" (interstitial, not the document)`);
      continue;
    }
    if (page.status < 200 || page.status >= 300 || !page.title) {
      counts.stillGone += 1;
      continue;
    }
    const name = cleanDirectoryTitle(page.title);
    if (!dry) {
      /*
       * A CORRECTED LEAD IS A NEW LEAD, AT THE ADDRESS THAT RESOLVES.
       *
       * The candidate id hashes the URL, so the stranded row cannot simply be
       * edited into the right one without becoming a row whose id no longer
       * describes it. Instead the correct address is recorded as its own lead,
       * parented to the SAME edge — so the provenance chain still runs back to
       * the page that named this agency — and the stranded row is marked as
       * the same entity at a dead address.
       *
       * Neither row is deleted. The dead address is what a future session needs
       * in order to recognise this shape a second time, and the reason is
       * written out rather than coded.
       */
      recordCandidate(w, {
        state,
        tier: c.tier,
        url: target,
        text: name,
        fromEdge: c.fromEdge,
        discoveredOn: stamp,
      });
      classifyCandidate(
        w,
        c.id,
        "DUPLICATE",
        `the recorded address ${c.url} does not resolve; route ${ROUTE_ID} found the same body at ${target} on ${stamp}, where the document names itself "${name}". ${pair.establishedBy}. The live lead is the one at ${target}; this row is kept because the dead address is how this shape is recognised next time.`,
      );
    }
    counts.recovered += 1;
    recovered.push({ id: c.id, name, url: target });
  }

  /* ---- 3. record what the route actually did ----------------------------- */
  const outcome = recordRouteOutcome(k, ROUTE_ID, {
    jurisdiction: state,
    walkedOn: stamp,
    rows: counts.recovered,
    outcome: counts.recovered > 0 ? "YIELDED" : counts.tried > 0 ? "ZERO" : "FAILED",
    note: `${counts.tried} stranded lead(s) retried on the redirect target; ${counts.recovered} resolved, ${counts.challenged} met an interstitial, ${counts.stillGone} still absent there`,
  });
  if (outcome.recorded) k = outcome.knowledge;
  console.log(`\noutcome: ${outcome.reason}`);

  if (!dry) {
    writeFileSync(STORE, `${JSON.stringify({ ...k, updatedOn: stamp }, null, 2)}\n`, "utf8");
    w.cursor = `${deriveCursor(w, state)} / route ${ROUTE_ID} applied on ${stamp}`;
    saveWorkstream(ROOT, w);
    writeFileSync(
      join(ROOT, "states", state, "recovered-addresses.md"),
      [
        `# ${state.toUpperCase()} — addresses recovered by \`${ROUTE_ID}\``,
        "",
        `**${stamp}.** ${counts.recovered} lead(s) whose recorded address did not resolve, and whose`,
        `correct address is the same path on the directory's redirect target.`,
        "",
        "| Body, as the directory names it | Correct address |",
        "|---|---|",
        ...recovered.map((r) => `| ${r.name} | ${r.url} |`),
        "",
      ].join("\n"),
      "utf8",
    );
  }

  console.log(`\n=== ROUTE ${ROUTE_ID} — ${state.toUpperCase()}${dry ? "  (DRY RUN)" : ""}`);
  console.log(`stranded leads retried       ${counts.tried}`);
  console.log(`  RECOVERED (address found)  ${counts.recovered}`);
  console.log(`  challenged (interstitial)  ${counts.challenged}   <- transport state, still owed`);
  console.log(`  absent on the target too   ${counts.stillGone}`);
  console.log(`  transport failed           ${counts.failed}`);
  /* Both numbers, against the population actually retried (RULING 159).
   * "69 recovered" without "of 80" cannot tell a route that works from a
   * route that was barely asked. */
  console.log(
    "  " +
      floorLine(
        counts.tried > 0
          ? floored("addresses recovered", "the stranded leads retried", counts.tried, counts.recovered)
          : floored("addresses recovered", "the stranded leads retried", 0, 0, "no lead on a known redirect host remained"),
      ),
  );
  console.log(`method version               ${k.version}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
