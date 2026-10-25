import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { readContractHandoff } from "../lib/civic-data/contract-handoff.ts";
import { writeContractHandoff } from "../lib/civic-data/contract-handoff-parent.ts";

const TS_CHILD = ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("10,000 long partition IDs cross the real Node child boundary intact without an oversized argv", () => {
  const ids = Array.from({ length: 10_000 }, (_, i) => `meetings:calendar:government%3AUS-AL%3A${i}:${"long-board-identity-".repeat(30)}`);
  const handoff = writeContractHandoff(ids);
  try {
    assert.ok(handoff.args.join(" ").length < 1000);
    const child = spawnSync(process.execPath, [...TS_CHILD, "--input-type=module", "-e",
      'import {readContractHandoff} from "./lib/civic-data/contract-handoff.ts"; import {createHash} from "node:crypto"; const ids=readContractHandoff(process.argv.slice(1)); console.log(JSON.stringify({count:ids.length,sha:createHash("sha256").update(JSON.stringify(ids)).digest("hex")}));',
      "--", ...handoff.args], { encoding: "utf8", timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { count: ids.length, sha: digest(ids) });
    assert.deepEqual(readContractHandoff(handoff.args), ids);
  } finally { handoff.cleanup(); }
});

test("missing, unreadable, short, empty and same-size altered files fail before acquisition", () => {
  const handoff = writeContractHandoff(["meetings:a", "meetings:b"]);
  const path = handoff.args[0]!.slice("--contracts-file=".length);
  const run = (args: readonly string[]) => spawnSync(process.execPath, [...TS_CHILD,
    "--input-type=module", "-e", 'import {readContractHandoff} from "./lib/civic-data/contract-handoff.ts"; readContractHandoff(process.argv.slice(1));', "--", ...args],
    { encoding: "utf8", timeout: 30_000 });
  try {
    const missing = run(handoff.args.map(arg => arg.startsWith("--contracts-file=") ? `${arg}-missing` : arg));
    assert.notEqual(missing.status, 0);
    assert.match(missing.stdout + missing.stderr, /CONTRACT_HANDOFF_UNREADABLE:ENOENT/);
    assert.throws(() => readContractHandoff(handoff.args.map(arg => arg.startsWith("--contracts-file=") ? `--contracts-file=${path}/..` : arg)), /CONTRACT_HANDOFF_UNREADABLE/);
    writeFileSync(path, JSON.stringify(["meetings:a"]));
    const short = run(handoff.args);
    assert.notEqual(short.status, 0);
    assert.match(short.stdout + short.stderr, /CONTRACT_HANDOFF_COUNT_MISMATCH: parent=2, child=1/);
    writeFileSync(path, "[]");
    assert.throws(() => readContractHandoff(handoff.args), /CONTRACT_HANDOFF_COUNT_MISMATCH/);
    writeFileSync(path, JSON.stringify(["meetings:a", "meetings:c"]));
    assert.throws(() => readContractHandoff(handoff.args), /CONTRACT_HANDOFF_CONTENT_MISMATCH/);
    assert.throws(() => readContractHandoff([]), /CONTRACT_HANDOFF_ARGUMENT_INVALID/);
    assert.throws(() => writeContractHandoff([]), /CONTRACT_HANDOFF_SELECTION_INVALID/);
    assert.throws(() => writeContractHandoff(["a", "a"]), /CONTRACT_HANDOFF_DUPLICATE_ID/);
  } finally { handoff.cleanup(); }
});
