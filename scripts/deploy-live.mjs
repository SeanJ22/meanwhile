#!/usr/bin/env node
/**
 * Which SHA is live, answered from Netlify's deploy record with zero requests
 * to the site (a request to the site writes a search-log row).
 *
 * It compares against the newest deploy-eligible commit on `main`
 * (`lib/ops/deploy-paths.ts`), not the tip: a docs-only tip is never built.
 *
 * Verdicts: current, behind, ahead, cannot-tell. No Netlify credential is
 * cannot-tell and exits 3, never 0.
 *
 * Reads `NETLIFY_AUTH_TOKEN` (or `NETLIFY_TOKEN`) and `NETLIFY_SITE_ID`
 * (default: the site domain below). A token is a Personal Access Token from
 * Netlify → User settings → Applications.
 */

import { DEPLOY_EXIT, verdictForDeploys } from "../lib/ops/deploy-verdict.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitFor } from "./git-lite.mjs";
import { loadEnvLocal } from "./load-env-local.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The deploys API answers 404 for the bare site name; the domain or site id works. */
const SITE = process.env.NETLIFY_SITE_ID || "sparkwtp.netlify.app";

loadEnvLocal();

const git = gitFor(ROOT);

function say(mark, label, detail) {
  console.log(`${mark} ${label.padEnd(22)} ${detail}`);
}

/**
 * The newest commit on `main` that Netlify would actually have built.
 *
 * Walks back from the tip, classifying each commit by its own changed paths.
 * Stops at the first deploy-eligible one, or gives up after `limit`.
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
 * Did the deploy carrying this SHA succeed? Asked about the commit itself, so a
 * failed deploy is not mistaken for one still building.
 *
 * ```
 * node scripts/deploy-live.mjs --sha=<sha>          # ask once
 * node scripts/deploy-live.mjs --sha=<sha> --wait   # poll to a terminal state
 * ```
 *
 *   0  SUCCESS      — a deploy carrying this SHA reached `ready`
 *   1  FAILED       — a deploy carrying this SHA is in `error`, with its message
 *   2  PENDING      — it exists and is still building, or has not appeared yet
 *   3  CANNOT-TELL  — no credential, or the API would not answer
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
  // Ten minutes at thirty-second intervals.
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

  // Ask about the deploy carrying this commit, not the newest ready deploy:
  // "behind" and "still building" must not read the same.
  const verdict = verdictForDeploys(deploys, eligible.sha);
  const short = eligible.sha.slice(0, 7);
  if (verdict.kind === "SUCCESS") {
    say("✓", "verdict", `CURRENT — production is serving ${short}. ${verdict.why}`);
    process.exit(0);
  }
  if (verdict.kind === "CANCELLED-BY-FILTER") {
    say("✓", "verdict", `${short} was correctly NOT built — ${verdict.why}`);
    process.exit(0);
  }
  if (verdict.kind === "FAILED") {
    say("✗", "verdict", `${short} FAILED to deploy — ${verdict.why}`);
    process.exit(1);
  }
  if (verdict.kind === "PENDING") {
    say("·", "verdict", `PENDING — ${verdict.why}. Not stale; not yet verified.`);
    process.exit(2);
  }
  say("?", "verdict", `CANNOT-TELL — ${verdict.why}`);
  process.exit(3);
}

await main();
