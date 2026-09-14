#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";
import { readerProofAuthority, readerProofHead } from "./lib/reader-proof-head.mjs";

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

const receiptBytes = readFileSync(receiptPath);
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const readerHead = readerProofHead(receipt, readEvidence);
const authority = readerProofAuthority(receipt, readEvidence, readerHead, { receiptPath, receiptBytes });

function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

const allAuthorityHistoryIsReachable = () =>
  isAncestor(readerHead, "HEAD") &&
  (authority.importerCodeSha === null || isAncestor(authority.importerCodeSha, readerHead));

if (!allAuthorityHistoryIsReachable()) {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  if (shallow !== "true") {
    if (!isAncestor(readerHead, "HEAD")) throw new Error(`Reader proof head ${readerHead} is not an ancestor of HEAD.`);
    throw new Error(`Reader importer head ${authority.importerCodeSha} is not an ancestor of Reader proof head ${readerHead}.`);
  }

  const ref = process.env.GITHUB_REF?.trim();
  if (!ref) throw new Error("GITHUB_REF is required to deepen a shallow reader-proof checkout.");
  for (let deepen = 8; deepen <= 256 && !allAuthorityHistoryIsReachable(); deepen *= 2) {
    execFileSync("git", ["fetch", "--no-tags", `--deepen=${deepen}`, "origin", ref], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
  }
}

if (!isAncestor(readerHead, "HEAD")) {
  throw new Error(`Reader proof head ${readerHead} is not reachable within the bounded shallow history.`);
}
if (authority.importerCodeSha !== null && !isAncestor(authority.importerCodeSha, readerHead)) {
  throw new Error(`Reader importer head ${authority.importerCodeSha} is not reachable before proof head ${readerHead} within the bounded shallow history.`);
}

console.log(`Reader proof ancestry: PASS (${readerHead}; authority=${authority.phase})`);
