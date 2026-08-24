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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitFor } from "./git-lite.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.NETLIFY_SITE_ID || "sparkwtp";

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
