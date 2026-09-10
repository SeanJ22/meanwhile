#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";
import { readerProofHead } from "./lib/reader-proof-head.mjs";

const root = process.cwd();
const receiptPath = "docs/evidence/reader-last-mile-final-closure-receipt.json";

function readEvidence(path) {
  if (existsSync(path)) return readFileSync(path);
  const pack = JSON.parse(readFileSync(`${path}.pack.json`, "utf8"));
  if (pack.encoding !== "gzip" || typeof pack.path !== "string") {
    throw new Error(`Unsupported reader evidence package for ${path}`);
  }
  return gunzipSync(readFileSync(pack.path));
}

const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const readerHead = readerProofHead(receipt, readEvidence);

function isAncestor() {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", readerHead, "HEAD"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

if (!isAncestor()) {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  if (shallow !== "true") {
    throw new Error(`Reader proof head ${readerHead} is not an ancestor of HEAD.`);
  }

  const ref = process.env.GITHUB_REF?.trim();
  if (!ref) throw new Error("GITHUB_REF is required to deepen a shallow reader-proof checkout.");
  for (let deepen = 8; deepen <= 256 && !isAncestor(); deepen *= 2) {
    execFileSync("git", ["fetch", "--no-tags", `--deepen=${deepen}`, "origin", ref], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
  }
}

if (!isAncestor()) {
  throw new Error(`Reader proof head ${readerHead} is not reachable within the bounded shallow history.`);
}

console.log(`Reader proof ancestry: PASS (${readerHead})`);
