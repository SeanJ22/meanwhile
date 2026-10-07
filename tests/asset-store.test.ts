import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("reference data and provenance stay in git", () => {
  const tracked = new Set(
    filesThatWouldBeCommitted({ cwd: ROOT }),
  );
  for (const must of [
    "data/reference/census_govt_units_2022.csv",
    "data/reference/nces_ccd_lea_directory_2025_26.csv",
    "data/derived/zip-coverage-tiers-runtime.json",
  ]) {
    assert.ok(tracked.has(must), `${must} must stay in git`);
  }
});
