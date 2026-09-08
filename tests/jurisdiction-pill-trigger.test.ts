import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("MTG-17: declining the address prompt restores the sourced Could-govern label", () => {
  const source = readFileSync(
    join(ROOT, "components/address/jurisdiction-pill.tsx"),
    "utf8",
  );
  const prompt = source.match(/<AddressPrompt[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(prompt, /trigger=\{copy\.label\}/);
  assert.match(prompt, /onCleared=\{\(\) => \{[\s\S]*?setOpen\(false\)/);
  assert.doesNotMatch(prompt, /trigger=["']Add address/);
});
