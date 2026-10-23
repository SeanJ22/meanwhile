import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { isPdfjsInternalRejection } from "../lib/extract/pdfjs-rejections.ts";

// A damaged publisher PDF makes pdf.js's in-process worker reject promises nothing awaits.
// Each case runs in its own process, because the point is whether that process survives.
const run = (body: string) => spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", `
  const { guardPdfjsRejections } = await import("./lib/extract/pdfjs-rejections.ts");
  const { InvalidPDFException } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  guardPdfjsRejections();
  ${body}
  await new Promise(resolve => setTimeout(resolve, 50));
  console.log("SURVIVED");`], { encoding: "utf8" });

test("a stray pdf.js rejection from a damaged file is recorded and the voting job keeps reading other sources", () => {
  const result = run(`void Promise.reject(new InvalidPDFException("Bad (uncompressed) XRef entry: 18R"));`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SURVIVED/);
  assert.match(result.stderr, /"event":"pdfjs_internal_rejection","name":"InvalidPDFException"/);
});

test("every other unhandled rejection still ends the process, as Node's default does", () => {
  const result = run(`void Promise.reject(new Error("an ordinary bug"));`);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /SURVIVED/);
  assert.match(result.stderr, /an ordinary bug/);
});

test("only pdf.js's own exception classes are recognized", () => {
  assert.equal(isPdfjsInternalRejection(new Error("plain")), false);
  const lookalike = Object.assign(new Error("not from pdf.js"), { name: "InvalidPDFException" });
  assert.equal(isPdfjsInternalRejection(lookalike), false);
  assert.equal(isPdfjsInternalRejection("XRefEntryException"), false);
});
