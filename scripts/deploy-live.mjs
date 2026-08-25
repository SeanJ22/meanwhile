#!/usr/bin/env node
/**
 * WHICH SHA IS LIVE — the one remaining question about production.
 *
 * RULING 125 (2026-08-24, Sean's ruling). Every walk, screenshot and card check
 * now runs against a LOCAL production build. This is the single fact a local
 * build cannot answer, and it is answered from **Netlify's deploy record**,
 * with **zero requests to the site** — because a request to the site writes a
 * search-log row, and that store is sold.
 *
 * ## IT COMPARES AGAINST THE LAST DEPLOY-ELIGIBLE COMMIT, NOT THE TIP
 *
 * This is the whole design and it is easy to get wrong. Since RULING 124 a
 * commit touching only `docs/` never builds — so `main`'s tip is routinely a
 * commit Netlify was correctly told to ignore. A check comparing the live SHA
 * against the tip would therefore report "production is behind" every time a
 * close-out lands, forever, and an alarm that is wrong on every quiet day is an
 * alarm nobody reads (RULING 115).
 *
 * So the comparison walks BACK from the tip to the newest commit that
 * `lib/ops/deploy-paths.ts` says is deploy-eligible, and compares THAT.
 *
 * ## FOUR VERDICTS, AND `CANNOT-TELL` IS NOT A PASS
 *
 * `current` · `behind` · `ahead` (the deploy record names a commit not on main)
 * · `cannot-tell`. RULING 24: a check that cannot reach its subject must never
 * print like a passing one. **No Netlify credential means `cannot-tell`**, and
 * this exits 3 for it rather than 0.
 *
 * Reads `NETLIFY_AUTH_TOKEN` (or `NETLIFY_TOKEN`) and `NETLIFY_SITE_ID`
 * (default: the site name below). A token is a Personal Access Token from
 * Netlify → User settings → Applications.
 */

import { existsSync, readFileSync } from "node:fs";
import { DEPLOY_EXIT, verdictForDeploys } from "../lib/ops/deploy-verdict.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitFor } from "./git-lite.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * THE SITE, AS THE DEPLOYS API WILL ACCEPT IT — and it was wrong all along.
 *
 * This read `"sparkwtp"`, the site's NAME, and the deploys endpoint answers
 * **HTTP 404** for a bare name. `pnpm deploy:live` had therefore been printing
 * `CANNOT-TELL` on every run since it was written, which is honest and is
 * exactly as useful as not having the check — the one production fact the
 * close-out reads was unreachable, and the message said so quietly enough that
 * nobody chased it.
 *
 * Measured 2026-08-25 against the same token, which works:
 *
 *   /sites                                            200, 2 sites
 *   /sites/sparkwtp/deploys                           404
 *   /sites/sparkwtp.netlify.app/deploys               200, 3 deploys
 *   /sites/6b39b212-…-a16faa9ecd08/deploys            200, 3 deploys
 *
 * So the default is the DOMAIN. `NETLIFY_SITE_ID` still overrides, and the site
 * id is what a CI environment usually has.
 */
const SITE = process.env.NETLIFY_SITE_ID || "sparkwtp.netlify.app";

function loadEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k] === undefined) {
      process.env[k] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

/* `git` is `gitFor(ROOT)` from ./git-lite.mjs — one copy (RULING 103). */
const git = gitFor(ROOT);

function say(mark, label, detail) {
  console.log(`${mark} ${label.padEnd(22)} ${detail}`);
}

/**
 * The newest commit on `main` that Netlify would actually have built.
 *
 * Walks back from the tip, classifying each commit by its own changed paths.
 * Stops at the first deploy-eligible one, or gives up after `limit` — a session
 * that shipped nothing but paperwork for 40 commits is not a state this needs
 * to resolve, and saying so beats walking to the root.
 */
async function lastDeployEligible(limit = 40) {
  const { classifyDeploy } = await import("../lib/ops/deploy-paths.ts");
  const shas = (git("rev-list", `-${limit}`, "main") ?? "").split("\n").filter(Boolean);
  const skipped = [];
  for (const sha of shas) {
    const files = git("show", "--name-only", "--format=", sha);
    if (files === null) return { sha: null, skipped, reason: `git show failed at ${sha.slice(0, 7)}` };
    const changed = files.split("\n").map((l) => l.trim()).filter(Boolean);
    const d = classifyDeploy(changed.length ? changed : null);
    if (d.verdict !== "cancel") return { sha, skipped };
    skipped.push(sha);
  }
  return { sha: null, skipped, reason: `no deploy-eligible commit in the last ${limit}` };
}

/**
 * **DID THE DEPLOY FOR THIS SHA SUCCEED?** — `NJ25`, closed 2026-08-25.
 *
 * ```
 * node scripts/deploy-live.mjs --sha=<sha>          # ask once
 * node scripts/deploy-live.mjs --sha=<sha> --wait   # poll to a terminal state
 * ```
 *
 * ## The gap this closes, and why the existing verdict did not close it
 *
 * `NJ25`: a session's deploy errored and nothing in the close-out path noticed.
 * The check above looks for the newest deploy whose state is `ready` and
 * compares its commit to the last deploy-eligible one. When the deploy for the
 * shipped SHA has ERRORED there is no ready deploy carrying it, so the newest
 * ready deploy is an OLDER commit and the verdict reads **BEHIND by 1**.
 *
 * That is not wrong, and it is not the sentence a reader needs. *Behind by one*
 * is exactly what a deploy still building looks like — so the one state that
 * demands action reads identically to the one state that demands patience, and
 * a session that waits is doing the right thing for a build and the wrong thing
 * for a failure.
 *
 * RULING 113: observe the step's product AT THE STEP. The product of a ship is
 * a DEPLOY, and the question is whether that deploy — the one carrying this
 * commit — reached `ready`.
 *
 * ## Four verdicts, kept apart
 *
 *   0  SUCCESS      — a deploy carrying this SHA reached `ready`
 *   1  FAILED       — a deploy carrying this SHA is in `error`, with its message
 *   2  PENDING      — it exists and is still building, or has not appeared yet
 *   3  CANNOT-TELL  — no credential, or the API would not answer
 *
 * `3` is not a pass, for the reason the whole file already gives.
 */
async function deployForSha(token, sha) {
  let res;
  try {
    res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE}/deploys?per_page=40`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return { verdict: "CANNOT-TELL", why: `request failed: ${err?.message ?? err}` };
  }
  if (!res.ok) return { verdict: "CANNOT-TELL", why: `HTTP ${res.status} from the deploys API` };
  const deploys = await res.json();
  if (!Array.isArray(deploys)) return { verdict: "CANNOT-TELL", why: "the deploys API returned no list" };
  /*
   * THE DECISION LIVES IN `lib/ops/deploy-verdict.ts`, not here.
   *
   * There was no failed deploy in the last forty to prove the FAILED verdict
   * against, so the only way to show the instrument catching the thing it was
   * written for is to PLANT one — and a decision reachable only through a live
   * API call is a decision nothing can test. RULING 130's shape: a production
   * path nothing could observe.
   */
  const v = verdictForDeploys(deploys, sha);
  return { verdict: v.kind, why: v.why, deploy: v.deploy };
}

const SHA_ARG = process.argv.find((a) => a.startsWith("--sha="))?.slice("--sha=".length);
if (SHA_ARG) {
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN || "";
  say("·", "site", SITE);
  say("·", "asking about", SHA_ARG.slice(0, 7));
  if (!token) {
    say("?", "verdict", "CANNOT-TELL — no NETLIFY_AUTH_TOKEN. This is not a pass.");
    process.exit(3);
  }
  const waiting = process.argv.includes("--wait");
  /* Ten minutes at thirty-second intervals — longer than this build takes, and
     short enough that a stuck deploy is reported rather than waited on forever. */
  const attempts = waiting ? 20 : 1;
  let last = { verdict: "CANNOT-TELL", why: "nothing asked" };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 30_000));
    last = await deployForSha(token, SHA_ARG);
    say(
      last.verdict === "FAILED" ? "✗" : last.verdict === "PENDING" || last.verdict === "CANNOT-TELL" ? "·" : "✓",
      `attempt ${i + 1}/${attempts}`,
      `${last.verdict} — ${last.why}`,
    );
    if (last.verdict === "SUCCESS" || last.verdict === "FAILED" || last.verdict === "CANCELLED-BY-FILTER") break;
  }
  say(
    last.verdict === "SUCCESS" || last.verdict === "CANCELLED-BY-FILTER" ? "✓" : "✗",
    "verdict",
    `${last.verdict} — ${last.why}`,
  );
  process.exit(DEPLOY_EXIT[last.verdict] ?? 3);
}

async function main() {
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN || "";
  const eligible = await lastDeployEligible();

  say("·", "site", SITE);
  say("·", "main tip", `${(git("rev-parse", "main") ?? "?").slice(0, 7)} ${git("log", "-1", "--format=%s", "main")?.slice(0, 58) ?? ""}`);
  if (eligible.sha) {
    say(
      "·",
      "last deployable",
      `${eligible.sha.slice(0, 7)} ${git("log", "-1", "--format=%s", eligible.sha)?.slice(0, 52) ?? ""}` +
        (eligible.skipped.length ? `  (${eligible.skipped.length} paperwork commit(s) above it, correctly not built)` : ""),
    );
  } else {
    say("·", "last deployable", `none found — ${eligible.reason}`);
  }

  if (!token) {
    say("?", "netlify", "NO CREDENTIAL — cannot reach the deploy record");
    console.log("");
    console.log("  This is CANNOT-TELL, not a pass. Set NETLIFY_AUTH_TOKEN in .env.local");
    console.log("  (Netlify → User settings → Applications → Personal access tokens).");
    console.log("");
    console.log("  Do NOT substitute a request to the site: /api/build answers the same");
    console.log("  question and writes reader-indistinguishable traffic to a sold store.");
    process.exit(3);
  }

  let res;
  try {
    res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE}/deploys?per_page=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    say("?", "netlify", `request failed: ${err?.message ?? err}`);
    process.exit(3);
  }
  if (!res.ok) {
    say("?", "netlify", `HTTP ${res.status} from the deploys API — cannot tell`);
    process.exit(3);
  }

  const deploys = await res.json();
  if (!Array.isArray(deploys) || deploys.length === 0) {
    say("?", "netlify", "the deploys API returned no deploys — cannot tell");
    process.exit(3);
  }

  const live = deploys.find((d) => d.state === "ready" && d.context === "production") ?? deploys[0];
  say("·", "live deploy", `${live.id} · ${live.state} · ${live.created_at}`);
  say("·", "live commit", `${(live.commit_ref ?? "?").slice(0, 7)}`);

  if (!eligible.sha) {
    say("?", "verdict", `CANNOT-TELL — ${eligible.reason}`);
    process.exit(3);
  }
  if (live.commit_ref === eligible.sha) {
    say("✓", "verdict", "CURRENT — production is serving the last deploy-eligible commit");
    process.exit(0);
  }
  const onMain = git("merge-base", "--is-ancestor", live.commit_ref ?? "", "main") !== null;
  if (!onMain) {
    say("✗", "verdict", `AHEAD/UNKNOWN — the live commit ${(live.commit_ref ?? "?").slice(0, 7)} is not an ancestor of main`);
    process.exit(2);
  }
  const behindBy = git("rev-list", "--count", `${live.commit_ref}..${eligible.sha}`) ?? "?";
  say("✗", "verdict", `BEHIND by ${behindBy} deploy-eligible commit(s)`);
  process.exit(2);
}

await main();
