import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { DIGEST_LOG_KEY } from "../control-plane/admin-data.ts";
import { REFERENCE_DIR } from "../reference/index.ts";

export const BALLOT_NAVIGATION_INPUT_PATH = join(REFERENCE_DIR, "..", "ballot", "2026-navigation.json");

export interface BallotPublicationResult {
  readonly kind: "BALLOT_PUBLICATION";
  readonly inputHash: string;
  readonly at: string;
  readonly status: "PUBLISHED" | "HELD";
  readonly versionId: string | null;
  readonly merged: readonly string[];
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
  readonly heldContests?: readonly BallotContestHold[];
  readonly reason: string | null;
}

export interface BallotContestHold {
  readonly state: string;
  readonly contestId: string;
  readonly title: string;
  readonly reason: string;
}

export async function ballotInputHash(directory: string): Promise<string> {
  const hash = createHash("sha256");
  if ((await stat(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; }))?.isFile()) {
    return hash.update(await readFile(directory)).digest("hex");
  }
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const file of files.filter(file => file.endsWith(".json")).sort()) {
    hash.update(file).update("\0").update(await readFile(resolve(directory, file))).update("\0");
  }
  return hash.digest("hex");
}

export function parseBallotPublicationResult(output: string): BallotPublicationResult | null {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith("BALLOT_PUBLICATION_RESULT="));
  if (lines.length !== 1) return null;
  try {
    const row = JSON.parse(lines[0].slice("BALLOT_PUBLICATION_RESULT=".length)) as BallotPublicationResult;
    if (row.kind !== "BALLOT_PUBLICATION" || !/^[a-f0-9]{64}$/.test(row.inputHash) || !Number.isFinite(Date.parse(row.at)) ||
      !["PUBLISHED", "HELD"].includes(row.status) || !(row.versionId === null || typeof row.versionId === "string") ||
      !(row.reason === null || typeof row.reason === "string") || !Array.isArray(row.merged) ||
      !row.merged.every(file => typeof file === "string" && /^[a-z]{2}\.json$/i.test(file)) || !Array.isArray(row.skipped) ||
      !row.skipped.every(item => item && typeof item.file === "string" && typeof item.reason === "string" && item.reason.length > 0) ||
      row.heldContests !== undefined && (!Array.isArray(row.heldContests) || !row.heldContests.every(item => item &&
        /^[A-Z]{2}$/.test(item.state) && typeof item.contestId === "string" && item.contestId.length > 0 &&
        typeof item.title === "string" && item.title.length > 0 && typeof item.reason === "string" && item.reason.length > 0))) return null;
    return row;
  } catch { return null; }
}

export async function readLatestBallotPublication(repos: ControlPlaneRepositories,
  field: "ballotPublication" | "ballotNavigationPublication" = "ballotPublication"): Promise<BallotPublicationResult | null> {
  const rows = await repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY,
    ["runtimeOutcome", field, "kind"], "BALLOT_PUBLICATION", 1, { runtimeOutcome: [field] });
  const report = (rows[0] as { runtimeOutcome?: Partial<Record<typeof field, BallotPublicationResult>> } | undefined)?.runtimeOutcome?.[field];
  return report ? parseBallotPublicationResult("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(report)) : null;
}

export function ballotPublicationDue(taskId: string, inputHash: string | null, prior: BallotPublicationResult | null): boolean {
  return ["ballot-contests", "ballot-navigation"].includes(taskId) && inputHash !== null && inputHash !== prior?.inputHash;
}
