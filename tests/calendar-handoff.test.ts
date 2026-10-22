import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { writeContractHandoff } from "../lib/civic-data/contract-handoff.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { selectedMeetingPartitions } from "../scripts/ingest.ts";

test("the server's calendar child reads its parent's complete exact selection across every state", () => {
  const ids = MEETING_PARTITION_CONTRACTS.filter(contract => contract.derivedFamily !== null).map(contract => contract.id);
  const handoff = writeContractHandoff(ids);
  try {
    assert.deepEqual(selectedMeetingPartitions(handoff.args).map(contract => contract.id), ids);
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "--import", "./tests/helpers/install-fixture-doors.ts", "--input-type=module", "-e",
      "import {selectedMeetingPartitions} from './scripts/ingest.ts'; console.log(JSON.stringify(selectedMeetingPartitions(process.argv.slice(1)).map(contract=>contract.id)));",
      "--", ...handoff.args], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "", WTP_DB_ROLE: "" }, maxBuffer: 1024 * 1024 });
    assert.deepEqual(JSON.parse(output.trim().split("\n").at(-1)!), ids);
    assert.throws(() => selectedMeetingPartitions([...handoff.args, `--only-partition=${ids[0]}`]), /SELECTION_AMBIGUOUS/);
    const path = handoff.args.find(arg => arg.startsWith("--contracts-file="))!.slice("--contracts-file=".length);
    writeFileSync(path, JSON.stringify(ids.slice(1)));
    assert.throws(() => selectedMeetingPartitions(handoff.args), /CONTRACT_HANDOFF_COUNT_MISMATCH/);
  } finally { handoff.cleanup(); }
  assert.throws(() => selectedMeetingPartitions(handoff.args), /CONTRACT_HANDOFF_UNREADABLE/);
});
