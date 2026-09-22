/** Scope software observation from complete Git differences and measured production. */
import { gitFor } from "./git-lite.mjs";
import { isDeepStrictEqual } from "node:util";
import { classifyDeploy } from "../lib/ops/deploy-paths.ts";
import { MAX_READING_AGE_HOURS } from "../lib/ops/production-integrity.ts";
import { productionIntegrityReceipt, validIntegrityRecord } from "../lib/ops/production-integrity-data-plane.ts";

function commit(git, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{7,40}$/.test(value)) return null;
  return git("rev-parse", "--verify", "--end-of-options", `${value}^{commit}`);
}

function pathsFromStatus(output) {
  if (output === null) return null;
  if (output === "") return [];
  const fields = output.split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0) return null;
  const paths = [];
  for (let i = 0; i < fields.length; i += 2) {
    // --no-renames reports both the removed and added name. A new unknown
    // pathname must not disappear behind Git's rename heuristic.
    if (!/^[ADMTUXB]$/.test(fields[i]) || fields[i + 1] === "") return null;
    paths.push(fields[i + 1]);
  }
  return paths;
}

/** First-parent differences describe what a merge introduced to its target. */
export function readCommitPaths(root, sha) {
  const git = gitFor(root);
  const head = commit(git, sha);
  if (head === null) return null;
  // cat-file retains real parent IDs in a shallow clone; rev-list can hide
  // them and make an unavailable parent look like a root commit.
  const object = git("cat-file", "-p", head);
  if (object === null) return null;
  const parent = /^parent ([a-f0-9]{40})$/m.exec(object.split("\n\n")[0])?.[1];
  return pathsFromStatus(parent
    ? git("diff", "--name-status", "--no-renames", "-z", parent, head, "--")
    : git("diff-tree", "--root", "--no-commit-id", "--name-status", "--no-renames", "-z", "-r", head, "--"));
}

export function readDeploymentRange(root, served, candidate) {
  const git = gitFor(root);
  const servedSha = commit(git, served);
  const candidateSha = commit(git, candidate);
  if (servedSha === null || candidateSha === null) return null;
  if (git("merge-base", "--is-ancestor", servedSha, candidateSha) === null) return null;
  const paths = pathsFromStatus(git("diff", "--name-status", "--no-renames", "-z", servedSha, candidateSha, "--"));
  return paths === null ? null : { servedSha, candidateSha, paths };
}

/** A skip must name a real fresh successful receipt for this served commit. */
export function receiptCoversServed(authority, servedSha, now) {
  if (authority?.kind !== "HELD" || !authority.receipt || !validIntegrityRecord(authority.record)) return false;
  const record = authority.record;
  const age = (now - Date.parse(record.observedAt ?? "")) / 3_600_000;
  const held = record.deployedSha === servedSha && record.observed === "HELD" &&
    record.moment === "post-deploy" && record.gateExit === 0 && record.failureClass === null &&
    Number.isFinite(age) && age >= 0 && age <= MAX_READING_AGE_HOURS;
  if (!held) return false;
  const runId = authority.receipt.sourceRunId;
  if (runId !== null && (typeof runId !== "string" || runId.trim() === "")) return false;
  // Reconstruct the exact existing writer envelope, including its actor and
  // record correspondence. A plausible ID alone is not a canonical receipt.
  return isDeepStrictEqual(authority.receipt, productionIntegrityReceipt(record, { runId }));
}

/** Accept only a fresh measured advance INSIDE the already-scoped range. */
export function isDocumentaryAdvance(root, originallyServedSha, candidateSha, observedSha) {
  const before = readDeploymentRange(root, originallyServedSha, observedSha);
  const after = readDeploymentRange(root, observedSha, candidateSha);
  return [before, after].every((range) => range !== null &&
    (range.paths.length === 0 || classifyDeploy(range.paths).verdict === "cancel"));
}

/**
 * The two live readers are injected so every refusal path is testable without
 * production. They must be the existing served-commit and canonical authority
 * readers. Unknown facts observe; they never authorize a skip.
 */
export async function observationScope(root, candidate, { observe, readAuthority, force = false, now = Date.now }) {
  const tip = classifyDeploy(readCommitPaths(root, candidate));
  const target = (reason) => ({ action: "observe-target", sha: candidate, reason });
  if (tip.verdict !== "cancel") return target(tip.reason);
  const served = await observe();
  const range = readDeploymentRange(root, served.sha, candidate);
  if (range === null) return target("The served-to-candidate ancestry or changed paths could not be proved; observation remains required.");
  // Empty is a proven identical range here, unlike an unreadable commit diff.
  if (range.paths.length > 0 && classifyDeploy(range.paths).verdict !== "cancel") {
    return target("The tip is documentary, but the complete served-to-candidate range contains unobserved software changes.");
  }
  const proof = `served ${range.servedSha}; candidate ${range.candidateSha}; ${range.paths.length} non-shipping changed paths across a proven ancestor range`;
  const authority = await readAuthority();
  if (!force && receiptCoversServed(authority, range.servedSha, now())) {
    return { action: "skip", sha: range.servedSha, reason: `${proof}; fresh canonical HELD receipt ${authority.receipt.id}. No software observation is owed.` };
  }
  // Production need not deploy a documentary tip. Re-read the actually served
  // commit using its proven identical software/schema inputs, never label a
  // receipt as proof that the documentary candidate was deployed.
  return { action: "observe-served", sha: range.servedSha, reason: `${proof}; a fresh integrity reading is required for the served software.` };
}
