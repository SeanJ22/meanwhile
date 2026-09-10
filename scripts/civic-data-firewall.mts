import { readFileSync } from "node:fs";

import { observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { civicDataFirewall } from "../lib/civic-data/firewall.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const root = process.cwd();
const paths = filesThatWouldBeCommitted({ cwd: root });
const files = Object.fromEntries(paths.map((path) => [path, readFileSync(path, "utf8")]));
const inventory = JSON.parse(files["docs/permanent-civic-data-plane-cutover-v2-inventory.json"] ?? "null");
const routineContracts = observableRoutineContracts();
const findings = civicDataFirewall({
  files,
  contracts: routineContracts,
  manualContracts: MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  inventory,
});
const fileFloor = floored(
  "would-commit files inspected",
  "the civic-data firewall repository census",
  paths.length,
  paths.length,
);
const contractFloor = floored(
  "production source contracts inspected",
  "the canonical routine plus explicit-owner source registries",
  routineContracts.length + MANUAL_PRODUCTION_SOURCE_CONTRACTS.length,
  routineContracts.length + MANUAL_PRODUCTION_SOURCE_CONTRACTS.length,
);
if (findings.length === 0) {
  console.log(
    `civic-data firewall: PASS — 0 findings across ${fileFloor.matched} of ${fileFloor.denominator} ` +
      `would-commit files and ${contractFloor.matched} of ${contractFloor.denominator} production contracts`,
  );
} else {
  console.error(`civic-data firewall: FAIL — ${findings.length} finding(s)`);
  for (const finding of findings) console.error(`  ${finding.code} · ${finding.path} · ${finding.detail}`);
  process.exitCode = 1;
}
