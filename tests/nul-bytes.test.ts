import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// A literal NUL makes ripgrep and `git grep` treat a source file as binary and skip it silently.
// Write `\u0000` instead.

const ROOT = join(import.meta.dirname, "..");

// Untracked files are included; the extension filter excludes binaries, which legitimately hold NUL.
function textFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) =>
      /\.(ts|tsx|js|jsx|mjs|mts|cjs|cts|json|md|css|scss|html|yml|yaml|csv|txt|sql|sh|ps1|toml)$/i.test(
        f,
      ),
    );
}

test("0A: no tracked source file contains a literal NUL byte", () => {
  const files = textFiles();

  // An emptied corpus would pass forever.
  assert.ok(
    files.length > 700,
    `only ${files.length} source-class files matched — the scan lost its corpus`,
  );

  const offenders: string[] = [];
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(ROOT, file));
    } catch {
      continue;
    }
    const count = bytes.filter((b) => b === 0).length;
    if (count > 0) {
      const at = bytes.indexOf(0);
      const line = bytes.subarray(0, at).toString("utf8").split("\n").length;
      offenders.push(
        `${file}: ${count} NUL byte(s), first at line ${line} — ` +
          `write the separator as the escape \\u0000, not the raw character`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a literal NUL byte makes ripgrep and `git grep` skip the file SILENTLY, " +
      "so every class sweep of this repo would miss it:\n" +
      offenders.join("\n"),
  );
});

// Built from a codepoint so this file never contains the byte it scans for.
test("0A: the byte check catches the shape it is guarding against", () => {
  const NUL = String.fromCharCode(0);
  const planted = Buffer.from(`const key = \`\${a}${NUL}\${b}\`;`, "utf8");
  assert.equal(planted.filter((b) => b === 0).length, 1);

  const clean = Buffer.from("const key = `${a}\\u0000${b}`;", "utf8");
  assert.equal(
    clean.filter((b) => b === 0).length,
    0,
    "the escape form must produce no NUL byte in the file",
  );

  // The escape produces the same string at runtime.
  assert.equal("\u0000", NUL);
});
