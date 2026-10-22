import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { readContractHandoff, writeContractHandoff } from "../lib/civic-data/contract-handoff.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { ROUTINE_READER_MEETING_BATCH_SIZE, routineReaderRepairDomains } from "../lib/civic-data/reader-repair-protocol.ts";
import { statesForRegistryDivisions } from "../lib/civic-data/state-scopes.ts";

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

test("missing, unreadable, short, empty and same-size altered files fail before repair admission", () => {
  const handoff = writeContractHandoff(["meetings:a", "meetings:b"]);
  const path = handoff.args[0]!.slice("--contracts-file=".length);
  const run = (args: readonly string[]) => spawnSync(process.execPath, [...TS_CHILD,
    "scripts/routine-civic-data-reader-repair.mts", "--meeting-aggregate", "--observed-at=2026-10-22T22:00:00.000Z", ...args],
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

test("the parent's exact contract snapshot survives a newer child registry; 10,000 boards get distinct bounded domains", () => {
  const original = [...MEETING_PARTITION_CONTRACTS];
  const prototype = original[0]!;
  assert.ok(prototype);
  const contracts = Array.from({ length: 10_000 }, (_, i) => ({ ...prototype, id: `meetings:snapshot:${i}`, scope: `snapshot:${i}` }));
  MEETING_PARTITION_CONTRACTS.splice(0, MEETING_PARTITION_CONTRACTS.length, ...contracts);
  try {
    const domains = routineReaderRepairDomains(contracts);
    assert.ok(domains.every(domain => domain.contracts.length <= ROUTINE_READER_MEETING_BATCH_SIZE));
    assert.equal(new Set(domains.map(domain => domain.id)).size, domains.length);
    assert.deepEqual(domains.flatMap(domain => domain.contracts.map(contract => contract.id)), contracts.map(contract => contract.id));
    const handoff = writeContractHandoff(domains[0]!.contracts);
    try {
      MEETING_PARTITION_CONTRACTS.splice(0);
      assert.deepEqual(readContractHandoff(handoff.args), domains[0]!.contracts);
    } finally { handoff.cleanup(); }
    const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
    assert.doesNotMatch(runner, /`--contracts=\$\{/);
    assert.match(runner, /writeContractHandoff\(domain.contracts\)/);
  } finally { MEETING_PARTITION_CONTRACTS.splice(0, MEETING_PARTITION_CONTRACTS.length, ...original); }
});

test("meeting readback children hold only one state's partitions while covering the entire selection", () => {
  const selected = MEETING_PARTITION_CONTRACTS;
  const domains = routineReaderRepairDomains(selected);
  assert.ok(domains.length >= 50, "every state's standing family has a readback domain");
  for (const domain of domains) {
    const states = new Set(domain.contracts.flatMap(contract => {
      const partition = selected.find(partition => partition.id === contract.id)!;
      return statesForRegistryDivisions([partition.derivedFamily ?? "", partition.ocdId ?? "", partition.bodyId]);
    }));
    assert.ok(states.size <= 1, `${domain.id} mixes ${[...states].join(", ")}`);
    assert.ok(domain.contracts.length <= ROUTINE_READER_MEETING_BATCH_SIZE);
  }
  assert.deepEqual(domains.flatMap(domain => domain.contracts.map(contract => contract.id)).sort(), selected.map(contract => contract.id).sort());
});
