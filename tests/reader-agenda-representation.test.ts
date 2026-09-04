import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("every held agenda representation reaches real routes and the real meeting leaf without portal/binary promotion or topic tail loss", () => {
  const raw = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { agendaRepresentationProof } from './scripts/lib/reader-agenda-representation-proof.ts';
    const proof=await agendaRepresentationProof();
    console.log(JSON.stringify({documents:proof.documentDenominator,meetings:proof.representations.length,topics:proof.topics.length,negatives:proof.negativeControls}));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000, maxBuffer: 2_000_000 });
  const result = JSON.parse(raw.trim().split(/\r?\n/).at(-1)!);
  const held = JSON.parse(readFileSync("data/meetings-snapshot.json", "utf8")) as { agendaDocuments?: unknown[] };
  assert.ok(Array.isArray(held.agendaDocuments) && held.agendaDocuments.length > 180, "The independent source-document denominator must remain substantive");
  assert.equal(result.documents, held.agendaDocuments.length, "Every current held document version must be represented");
  assert.equal(result.topics, 8);
  assert.ok(result.meetings > 180);
  assert.ok(Object.values(result.negatives).every(value => value === true));
});
