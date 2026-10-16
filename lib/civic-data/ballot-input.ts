import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { requireBallotState, type BallotState } from "./state-scopes.ts";

const git = promisify(execFile);

export async function ballotInputHash(directory: string, state: BallotState): Promise<string> {
  const hash = createHash("sha256");
  const file = `${requireBallotState(state).toLowerCase()}.json`;
  hash.update(file).update("\0");
  try {
    for await (const chunk of createReadStream(resolve(directory, file))) hash.update(chunk);
    hash.update("\0");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return hash.digest("hex");
}

export async function ballotInputStamp(directory: string, state: BallotState): Promise<string> {
  const file = `${requireBallotState(state).toLowerCase()}.json`;
  // Runtime admission guarantees a clean checkout; blob IDs survive fresh checkouts.
  const tree = await git("git", ["ls-tree", "-z", "HEAD", "--", file], { cwd: directory }).catch((error: { code?: number }) => {
    if (error.code === 128) return null;
    throw error;
  });
  const blob = tree?.stdout.match(/^\d+ blob ([a-f0-9]{40,64})\t/);
  return blob ? `git:${blob[1]}` : `content:${await ballotInputHash(directory, state)}`;
}
