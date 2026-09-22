import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

test("ordinary modules delegate without loading the TSX compiler and preserve loader errors", async () => {
  const require = createRequire(import.meta.url);
  const compilerPath = require.resolve("typescript");
  assert.equal(require.cache[compilerPath] === undefined, true);
  const loader = await import("../scripts/test-alias-loader.mjs");
  const expected = { format: "module", source: "export const value = 4;" };
  const context = { format: "module" };
  let delegated = false;
  const actual = await loader.load("file:///ordinary.ts", context, (url: string, seen: unknown) => {
    delegated = true;
    assert.equal(url, "file:///ordinary.ts");
    assert.equal(seen, context);
    return expected;
  });
  assert.equal(actual, expected);
  assert.equal(delegated, true);
  const sentinel = new Error("delegate loader failure");
  await assert.rejects(async () => loader.load("file:///ordinary.ts", context, () => { throw sentinel; }),
    (error: unknown) => error === sentinel);
  assert.equal(require.cache[compilerPath] === undefined, true, "ordinary TS uses Node stripping, not the TSX compiler");
});

test("canonical isolated loader preserves transitive JSX, aliases, bare resolution, CSS/JSON and real failures", () => {
  const home = join(ROOT, ".scratch", "ci");
  mkdirSync(home, { recursive: true });
  const root = mkdtempSync(join(home, "alias-loader-proof-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(root, "scripts", "register-test-loader.mjs"),
      `import ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "register-test-loader.mjs")).href)};\n`);
    writeFileSync(join(root, "value.ts"), "export const value: number = 4;\n");
    writeFileSync(join(root, "value.json"), '{"label":"source value"}\n');
    writeFileSync(join(root, "view.module.css"), ".card { color: inherit; }\n");
    const commonJsExport = ["module", "exports"].join(".");
    writeFileSync(join(root, "node_modules", "loader-proof-bare.js"), `${commonJsExport} = { value: 9 };\n`);
    const view = `import { value } from '@/value'; import data from '@/value.json'; import styles from '@/view.module.css';
      const typed: number = value; export const element = <span className={styles.card} data-label={data.label}>{typed}</span>;
      export const absentClass = styles.notDeclared;`;
    writeFileSync(join(root, "view.tsx"), view);
    writeFileSync(join(root, "bridge.ts"), "export { element, absentClass } from '@/view';\n");
    const passing = `import test from 'node:test'; import assert from 'node:assert/strict';
      import { element, absentClass } from '@/bridge'; import bare from 'loader-proof-bare';
      test('actual transitive JSX', () => {
        assert.equal(element.type, 'span'); assert.equal(element.props.className, 'card');
        assert.equal(element.props['data-label'], 'source value'); assert.equal(element.props.children, EXPECTED, 'planted loader assertion');
        assert.equal(absentClass, undefined); assert.equal(bare.value, 9);
      });`;
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    for (const mode of ["pass", "assertion", "missing-import", "syntax"] as const) {
      writeFileSync(join(root, "view.tsx"), mode === "syntax" ? "export const element = ;\n" : view);
      writeFileSync(join(root, "fixture.test.ts"), mode === "missing-import" ? "import './missing-loader-file.ts';\n"
        : passing.replace("EXPECTED", mode === "assertion" ? "5" : "4"));
      const result = spawnSync(process.execPath, ["--test", "--experimental-strip-types", "--import",
        "./scripts/register-test-loader.mjs", "--test-concurrency=1", "--test-reporter=spec", "fixture.test.ts"], {
        cwd: root, env, encoding: "utf8", timeout: 10_000, windowsHide: true,
      });
      assert.equal(result.error, undefined, `${mode} must complete naturally`);
      assert.equal(result.signal, null, `${mode} must return an exit code`);
      const output = result.stdout + result.stderr;
      if (mode === "pass") assert.equal(result.status, 0, output);
      else {
        assert.notEqual(result.status, 0, `${mode} must remain a failed process`);
        assert.match(output, mode === "assertion" ? /planted loader assertion/
          : mode === "syntax" ? /SyntaxError/ : /ERR_MODULE_NOT_FOUND/);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
