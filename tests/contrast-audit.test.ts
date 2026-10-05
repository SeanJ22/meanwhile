import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditContrast } from "../scripts/contrast-audit.mts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("reader token pairs clear their contrast bars in both themes", () => {
  const result = auditContrast(css);
  assert.equal(result.failures, 0, result.rows.filter((row) => /FAIL|\?\?/.test(row)).join("\n"));
});

test("a low-contrast palette and a missing surface cannot silently pass", () => {
  const dim = css.replace(/--text:\s*#[0-9a-f]+;/i, "--text: #181a20;");
  assert.ok(auditContrast(dim).failures > 0);
  assert.ok(auditContrast(css.replace(/--panel-bg:\s*#[0-9a-f]+;/gi, "")).failures > 0);
});
