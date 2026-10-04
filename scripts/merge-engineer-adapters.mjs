/**
 * Merge green `engineer-adapter/<kind>` pull requests, one at a time.
 * Active only while the adapter publication switch reads `pr`; under `river`
 * the engineer opens no pull requests and River merges `stream/adapter-<kind>`
 * instead, so this merges nothing (RL-06: one active publisher).
 */
import { ADAPTER_PUBLICATION_ENV, readAdapterPublication } from "../lib/control-plane/workers/adapter-publication.mjs";

const repo = process.env.GH_REPOSITORY;
const headers = { Accept: "application/vnd.github+json", "Content-Type": "application/json", Authorization: `Bearer ${process.env.GH_TOKEN}` };
const adapterPath = path => path.startsWith("lib/sources/platform-adapters/") && /\.[cm]?[jt]sx?$/.test(path) && !/(?:^|\/)(?:evidence|fixtures)(?:\/|$)/.test(path);
async function api(path, body) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers, method: body ? "PUT" : "GET", body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status}: ${path}`);
  return response.json();
}
async function pages(path, field) {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const items = field ? result[field] : result;
    rows.push(...items);
    if (items.length < 100) return rows;
  }
}
async function mergeGreenAdapterPullRequests() {
  for (const pr of await pages(`repos/${repo}/pulls?state=open&base=main`)) {
    if (pr.draft || pr.head.repo?.full_name !== repo || !pr.labels.some(label => label.name === "engineer-adapter")) continue;
    const files = await pages(`repos/${repo}/pulls/${pr.number}/files`);
    const detail = await api(`repos/${repo}/pulls/${pr.number}`);
    if (detail.head.sha !== pr.head.sha || files.length !== detail.changed_files || !files.length || files.some(file => !adapterPath(file.filename) || (file.previous_filename && !adapterPath(file.previous_filename)))) {
      console.log(`#${pr.number}: contains files outside the adapter implementation/test path`);
      continue;
    }
    const checks = await pages(`repos/${repo}/commits/${pr.head.sha}/check-runs?filter=latest`, "check_runs");
    const required = ["build (default)", "build (standalone)", "gates (test · lint · tsc)"];
    if (checks.some(check => check.status !== "completed" || ["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"].includes(check.conclusion)) ||
        required.some(name => !checks.some(check => check.name === name && check.status === "completed" && check.conclusion === "success"))) {
      console.log(`#${pr.number}: CI has not passed on ${pr.head.sha}`);
      continue;
    }
    try {
      const result = await api(`repos/${repo}/pulls/${pr.number}/merge`, { merge_method: "squash", sha: pr.head.sha });
      console.log(`#${pr.number}: ${result.merged ? "merged" : result.message}`);
    } catch (error) {
      // Branch rules still apply, including a newer main requiring another run.
      console.log(`#${pr.number}: merge deferred (${error.message})`);
    }
  }
}

const publication = readAdapterPublication(process.env);
if (publication.mode === "pr") {
  await mergeGreenAdapterPullRequests();
} else {
  console.log(publication.problem
    ?? `adapter merges are off: ${ADAPTER_PUBLICATION_ENV} reads river (${publication.source}); River integrates stream/adapter-* instead`);
}
