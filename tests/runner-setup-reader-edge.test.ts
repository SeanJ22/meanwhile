/**
 * The Linux runner must never be set up to publish reader pages to a local
 * folder. `WTP_READER_EDGE_DIR` makes `resolveReaderArtifactWriteStore()` prefer
 * a folder on the droplet over the live site, which left readers on a six-day-old
 * snapshot (board/river releases/stale-reader-snapshot.md). The setup converter
 * neither adds it nor passes a stray copy through from the source settings.
 *
 * The converter is PowerShell. When `pwsh` is present the real function runs;
 * otherwise the test reads its override table and skip condition and applies
 * them the same way, so the check still runs in CI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const setup = readFileSync("deploy/runner/setup.ps1", "utf8");
const install = readFileSync("deploy/runner/install.sh", "utf8");

function overrides(): Map<string, string> {
  const block = setup.match(/\$overrides = \[ordered\]@\{([\s\S]*?)\n\s*\}/);
  assert.ok(block, "setup.ps1 keeps its override table");
  const entries = new Map<string, string>();
  for (const line of block[1].split("\n")) {
    const entry = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'([^']*)'/);
    if (entry) entries.set(entry[1], entry[2]);
  }
  return entries;
}

function skipped(name: string, table: Map<string, string>): boolean {
  const condition = setup.match(/if \((\$name -match 'PROD'[^{]*)\) \{ continue \}/);
  assert.ok(condition, "setup.ps1 keeps its skip condition");
  const exact = [...condition[1].matchAll(/\$name -eq '([^']+)'/g)].map((match) => match[1]);
  return /PROD/.test(name) || exact.includes(name) || table.has(name);
}

function convert(text: string): string {
  const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion"], { encoding: "utf8" });
  if (pwsh.status === 0) {
    const dir = mkdtempSync(join(tmpdir(), "runner-setup-"));
    const input = join(dir, "in.env");
    writeFileSync(input, text);
    const run = spawnSync("pwsh", ["-NoProfile", "-Command",
      `. ./deploy/runner/setup.ps1; [Console]::Out.Write((ConvertTo-LinuxRunnerSettings ([IO.File]::ReadAllText('${input}'))))`],
    { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  }
  const table = overrides();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => {
    const named = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return !(named && skipped(named[1], table));
  });
  for (const [key, value] of table) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

test("setup adds no local reader folder to the runner settings", () => {
  assert.equal(overrides().has("WTP_READER_EDGE_DIR"), false);
  assert.doesNotMatch(install, /reader-edge/);
});

test("a stray WTP_READER_EDGE_DIR in the source settings never reaches the runner, and the other overrides are unchanged", () => {
  const source = [
    "NETLIFY_SITE_ID=site",
    "WTP_READER_EDGE_DIR=/var/lib/meanwhile/reader-edge",
    "export WTP_READER_EDGE_DIR=C:\\edge",
    "WTP_ADMIN_SESSION_KEY=secret",
    "DATABASE_URL_PROD=prod",
    "WTP_RUNTIME_MODE=production",
  ].join("\n");
  const output = convert(source);
  assert.doesNotMatch(output, /WTP_READER_EDGE_DIR/);
  assert.match(output, /^NETLIFY_SITE_ID=site$/m);
  assert.doesNotMatch(output, /WTP_ADMIN_SESSION_KEY|DATABASE_URL_PROD/);
  assert.deepEqual([...overrides().keys()], [
    "WTP_RUNTIME_MODE", "WTP_DB_ROLE", "WTP_RUNTIME_REPO", "WTP_BILLING_ENV_FILE",
    "WTP_MIRROR", "WTP_OCR_BINARY", "WTP_PDF_RASTERIZER", "PLAYWRIGHT_BROWSERS_PATH",
  ]);
  for (const [key, value] of overrides()) assert.match(output, new RegExp(`^${key}=${value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"));
  assert.doesNotMatch(output, /^WTP_RUNTIME_MODE=production$/m);
});
