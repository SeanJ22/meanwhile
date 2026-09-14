import assert from "node:assert/strict";
import test from "node:test";

import { assignment } from "../scripts/cli-args.mts";

test("assignment reads only the exact --name=value argument", () => {
  const argv = ["node", "script.mts", "--package=C:/review/input.json", "--contract=prl"];
  assert.equal(assignment(argv, "package"), "C:/review/input.json");
  assert.equal(assignment(argv, "contract"), "prl");
  assert.equal(assignment(argv, "pack"), null);
  assert.equal(assignment(["--package", "separate.json"], "package"), null);
});
