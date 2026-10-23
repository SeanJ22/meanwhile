import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { writeContractHandoff } from "../lib/civic-data/contract-handoff-parent.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { selectedMeetingPartitions } from "../scripts/ingest.ts";
import { installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

test("the server's calendar child reads its parent's complete exact selection across every state", () => {
  const contracts = MEETING_PARTITION_CONTRACTS.filter(contract => contract.derivedFamily !== null);
  const ids = contracts.map(contract => contract.id);
  const handoff = writeContractHandoff(contracts);
  try {
    assert.deepEqual(selectedMeetingPartitions(handoff.args).map(contract => contract.id), ids);
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "--import", "./tests/helpers/install-fixture-doors.ts", "--input-type=module", "-e",
      "import {selectedMeetingPartitions} from './scripts/ingest.ts'; console.log(JSON.stringify(selectedMeetingPartitions(process.argv.slice(1)).map(contract=>contract.id)));",
      "--", ...handoff.args], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "", WTP_DB_ROLE: "" }, maxBuffer: 1024 * 1024 });
    assert.deepEqual(JSON.parse(output.trim().split("\n").at(-1)!), ids);
    assert.throws(() => selectedMeetingPartitions([...handoff.args, `--only-partition=${ids[0]}`]), /SELECTION_AMBIGUOUS/);
    const path = handoff.args.find(arg => arg.startsWith("--contracts-file="))!.slice("--contracts-file=".length);
    writeFileSync(path, JSON.stringify(contracts.slice(1)));
    assert.throws(() => selectedMeetingPartitions(handoff.args), /CONTRACT_HANDOFF_COUNT_MISMATCH/);
  } finally { handoff.cleanup(); installFixtureDoors(); }
  assert.throws(() => selectedMeetingPartitions(handoff.args), /CONTRACT_HANDOFF_UNREADABLE/);
});

test("a calendar child keeps its parent's wiring after the registry loses that exact route", () => {
  const contract = MEETING_PARTITION_CONTRACTS.find(contract => contract.wiring !== null)!;
  const handoff = writeContractHandoff([contract]);
  try {
    MEETING_PARTITION_CONTRACTS.splice(0);
    assert.deepEqual(selectedMeetingPartitions(handoff.args), [contract]);
    assert.deepEqual(MEETING_PARTITION_CONTRACTS, [contract]);
  } finally { handoff.cleanup(); installFixtureDoors(); }
});
