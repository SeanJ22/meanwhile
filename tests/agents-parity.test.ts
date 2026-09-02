/**
 * **AGENTS.md / CLAUDE.md PARITY — the seeded failures.** (Provider transition,
 * 2026-09-02.)
 *
 * The invariant: everything operative in the root `CLAUDE.md` is supplied to
 * a non-Claude coding agent through the root `AGENTS.md`, mechanically. The
 * in-place regeneration in `tests/generated-artifacts.test.ts` is the gate
 * that holds it; these tests plant the ways it could silently stop holding:
 *
 *   1  a hand edit inside the mirror is STALE, by line
 *   2  a CLAUDE.md change that was not regenerated is STALE, and the digest says so
 *   3  the Next.js block survives regeneration byte-for-byte, including a
 *      block `next dev` has just rewritten
 *   4  a file with no Next.js block is REFUSED — the generator never invents it
 *   5  the mirror says it is not an authority, names the canonical store, and
 *      says who wins a disagreement
 *   6  AGENTS.md is registered as a pure generated artifact under the sync command
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  LAW_HEADING,
  MIRROR_BEGIN_PREFIX,
  MIRROR_END,
  NEXT_BEGIN,
  NEXT_END,
  checkAgentsFile,
  normalize,
  renderAgentsFile,
  splitNextBlock,
} from "../lib/ops/agents-mirror.mjs";
import { GENERATED } from "../lib/ops/generated-register.ts";

const ROOT = join(import.meta.dirname, "..");
const CLAUDE = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
const AGENTS = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

test("AGENTS.md is the Next block plus a byte-exact generated mirror of CLAUDE.md", () => {
  const verdict = checkAgentsFile(AGENTS, CLAUDE);
  assert.ok(verdict.ok, verdict.reason);
  const text = normalize(AGENTS);
  const law = text.indexOf(LAW_HEADING);
  const nextEnd = text.indexOf(NEXT_END);
  assert.ok(nextEnd > 0 && law > nextEnd, "the law heading must follow the Next block");
  assert.equal(text.slice(nextEnd + NEXT_END.length, law).trim(), "", "nothing sits between the Next block and the law");
  const begin = text.indexOf(MIRROR_BEGIN_PREFIX);
  const end = text.indexOf(MIRROR_END);
  assert.ok(begin > law && end > begin, "the mirror markers frame the constitution");
  /* The whole constitution travels: its first and last lines are inside the markers. */
  const body = normalize(CLAUDE).trim();
  const inside = text.slice(begin, end);
  assert.ok(inside.includes(body.split("\n")[0]), "CLAUDE.md's first line is in the mirror");
  assert.ok(inside.includes(body.split("\n").at(-1) ?? ""), "CLAUDE.md's last line is in the mirror");
  assert.ok(inside.includes("## The acquisition doctrine"), "the doctrine section travels");
  assert.ok(inside.includes("## Ask before"), "the ask-before section travels");
});

test("SEEDED: a hand edit inside the mirror is STALE, by line", () => {
  const planted = normalize(AGENTS).replace("## The acquisition doctrine", "## The acquisition suggestion");
  assert.notEqual(planted, normalize(AGENTS), "the plant must land");
  const verdict = checkAgentsFile(planted, CLAUDE);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /STALE against CLAUDE.md: first difference at line \d+/);
  assert.match(verdict.reason, /pnpm agents:sync/);
});

test("SEEDED: a CLAUDE.md change that was not regenerated is STALE, and the digest says so", () => {
  const amended = normalize(CLAUDE).replace("**Never generate a candidate position.**", "**Never generate a candidate position, ever.**");
  assert.notEqual(amended, normalize(CLAUDE), "the amendment must land");
  const verdict = checkAgentsFile(AGENTS, amended);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /does not match the current CLAUDE.md/);
});

test("the Next.js block survives regeneration byte-for-byte, including one next dev just rewrote", () => {
  const rewritten = normalize(AGENTS).replace(
    "This version has breaking changes",
    "This version has DIFFERENT breaking changes (rewritten by next dev in a test)",
  );
  assert.notEqual(rewritten, normalize(AGENTS));
  const regenerated = renderAgentsFile(rewritten, CLAUDE);
  const { nextBlock } = splitNextBlock(rewritten);
  assert.ok(regenerated.startsWith(nextBlock), "the rewritten block is preserved verbatim at the top");
  assert.ok(regenerated.includes("DIFFERENT breaking changes"), "the generator did not restore an older block");
  assert.equal(checkAgentsFile(regenerated, CLAUDE).ok, true, "a regenerated file is current");
  /* Idempotent: regenerating the current file changes nothing. */
  assert.equal(renderAgentsFile(normalize(AGENTS), CLAUDE), normalize(AGENTS));
});

test("SEEDED: a file with no Next.js block is REFUSED — the generator never invents it", () => {
  const stripped = normalize(AGENTS).replace(NEXT_BEGIN, "").replace(NEXT_END, "");
  assert.throws(() => renderAgentsFile(stripped, CLAUDE), /carries no .*block/);
  const verdict = checkAgentsFile(stripped, CLAUDE);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /never invents it/);
});

test("the mirror says it is not an authority, names the canonical store, and says who wins", () => {
  const text = normalize(AGENTS);
  const notice = text.slice(text.indexOf(MIRROR_BEGIN_PREFIX), text.indexOf("# CLAUDE.md — the root constitution"));
  assert.match(notice, /NOT an authority/);
  assert.match(notice, /the ledger wins/i);
  assert.ok(notice.includes("docs/governance/ledger.jsonl"));
  assert.ok(notice.includes("CLAUDE.md` is right"), "the notice says CLAUDE.md wins over the mirror");
  assert.ok(notice.includes("pnpm agents:sync"), "the notice names the regenerate command");
});

test("AGENTS.md is registered as a pure generated artifact under the sync command", () => {
  const entry = GENERATED.find((a) => a.path === "AGENTS.md");
  assert.ok(entry, "AGENTS.md is not in lib/ops/generated-register.ts — the in-place regeneration gate does not cover it");
  assert.equal(entry.command, "corepack pnpm agents:sync");
  assert.equal(entry.pure, true);
});
