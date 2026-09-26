import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { runOcr } from "../lib/extract/ocr.ts";

test("scanned PDF pages are rasterized before OCR, numerically ordered and cleaned up", async () => {
  let scratch = "";
  const inputs: string[] = [];
  const result = await runOcr(new Uint8Array([37, 80, 68, 70]), "scan.pdf", {
    binary: process.execPath, rasterizer: "test-poppler",
    execute(binary, args) {
      if (binary === "test-poppler") {
        assert.deepEqual(args.slice(0, 3), ["-r", "300", "-png"]);
        scratch = dirname(args[3]);
        assert.ok(existsSync(args[3]));
        for (let page = 12; page >= 1; page--) writeFileSync(join(scratch, `page-${page}.png`), "image");
      } else {
        assert.match(args[0], /\.png$/);
        assert.ok(!args[0].endsWith(".pdf"));
        inputs.push(args[0]);
        const page = Number(/page-(\d+)\.png$/.exec(args[0])![1]);
        writeFileSync(`${args[1]}.txt`, page === 2 ? " " : `Page ${page}`);
      }
    },
  });
  assert.equal(result.outcome, "EXTRACTED");
  assert.equal(result.counts.pages, 12);
  assert.deepEqual(result.items.map(row => row.page), [1,3,4,5,6,7,8,9,10,11,12]);
  assert.equal(result.items[10].text, "Page 12");
  assert.equal(inputs.length, 12);
  assert.equal(existsSync(scratch), false);
});

test("missing rasterizer and incomplete page conversion refuse OCR without false empty success", async () => {
  for (const scenario of ["missing", "gap", "empty"] as const) {
    let calls = 0;
    let scratch = "";
    const result = await runOcr(new Uint8Array([1]), "scan.pdf", {
      binary: process.execPath,
      execute(_binary, args) {
        calls++;
        scratch = dirname(args[3]);
        if (scenario === "missing") throw new Error("pdftoppm ENOENT");
        if (scenario === "gap") writeFileSync(join(scratch, "page-2.png"), "image");
      },
    });
    assert.equal(result.outcome, "CANNOT_RUN");
    assert.match(result.reason, /PDF rasterisation failed/);
    assert.equal(calls, 1, "no PDF is ever passed to Tesseract");
    assert.equal(existsSync(scratch), false);
  }
});

test("failure on a later scanned page never publishes a truncated extraction", async () => {
  let scratch = "";
  const result = await runOcr(new Uint8Array([1]), "scan.pdf", {
    binary: process.execPath, rasterizer: "test-poppler",
    execute(binary, args) {
      if (binary === "test-poppler") {
        scratch = dirname(args[3]);
        for (const page of [1,2]) writeFileSync(join(scratch, `page-${page}.png`), "image");
      } else if (args[0].endsWith("page-1.png")) writeFileSync(`${args[1]}.txt`, "Page one");
      else throw new Error("OCR timeout");
    },
  });
  assert.equal(result.outcome, "CANNOT_RUN");
  assert.match(result.reason, /OCR page 2 failed/);
  assert.equal(result.rows, 0);
  assert.equal(existsSync(scratch), false);
});
