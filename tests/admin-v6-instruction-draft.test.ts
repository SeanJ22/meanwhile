import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { instructionDraftFor, withInstructionDraft } from "../app/(admin)/_mw/admin-v6/instruction-draft.ts";

test("an unsent instruction survives screen navigation but stays bound to its selected place", () => {
  const original = "zcta:2020/85635";
  const other = "zcta:2020/85636";
  let drafts = withInstructionDraft({}, original, { text: "Read the saved roster", chosenBody: "body-1" });

  // Screen changes do not change the command-center draft book.
  assert.deepEqual(instructionDraftFor(drafts, original), { text: "Read the saved roster", chosenBody: "body-1" });
  assert.deepEqual(instructionDraftFor(drafts, other), { text: "", chosenBody: null });

  drafts = withInstructionDraft(drafts, other, { text: "Check this place", chosenBody: null });
  assert.equal(instructionDraftFor(drafts, original).text, "Read the saved roster");
  assert.equal(instructionDraftFor(drafts, other).text, "Check this place");
  assert.deepEqual(instructionDraftFor({}, "__proto__"), { text: "", chosenBody: null });

  const shell = readFileSync(resolve("app/(admin)/_mw/admin-v6/command-center.tsx"), "utf8");
  const now = readFileSync(resolve("app/(admin)/_mw/admin-v6/screen-now.tsx"), "utf8");
  assert.match(shell, /<NowScreen key=\{scopeKey\}\s*\/>/, "switching place must discard any actionable prior read-back");
  assert.match(now, /const \[parsed, setParsed\] = useState<Parsed \| null>\(null\)/);
  assert.match(now, /v\.setInstructionDraft\(\{ text: next, chosenBody: null \}\)/);
});
