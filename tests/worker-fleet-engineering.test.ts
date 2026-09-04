import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { defaultGrant } from "../lib/control-plane/capability.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { ENGINEERING_METHOD_ID, runEngineeringWorker } from "../lib/control-plane/workers/engineering.ts";
import type { EngineeringWorkerInput } from "../lib/control-plane/workers/engineering-types.ts";
import type { WorkerEvidence } from "../lib/control-plane/workers/types.ts";

const STAMP = "2026-09-02T12:00:00.000Z";
const methodText = readFileSync(new URL("../data/method/knowledge.json", import.meta.url), "utf8");

function evidence(artifactId: string, text: string, canonicalUrl: string): WorkerEvidence {
  return { artifactId, text, contentHash: contentHash(text), canonicalUrl, acquiredByAttemptId: "at-test-capture",
    retrievedAt: STAMP, sourceId: "engineering-control", methodRouteId: ENGINEERING_METHOD_ID };
}

/** Explicit controls, never counted as live civic evidence or external validation. */
function request(): EngineeringWorkerInput {
  const site = "https://www.coronafire.org";
  const sourceUrl = `${site}/2026-09-01-board-meeting`;
  const sitemap = evidence("art-sitemap-control", `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${sourceUrl}</loc></url><url><loc>${site}/staff</loc></url></urlset>`, `${site}/sitemap.xml`);
  return {
    attemptId: "at-engineering-control", worker: { role: "ENGINEERING", provider: "deterministic", version: "1.0.0", instance: "engineering-control" },
    grant: { ...defaultGrant({ role: "ENGINEERING", project: "engineering-control", policyVersion: "review-only", grantedAt: STAMP }), capabilities: ["VAULT_READ_SANITIZED"] },
    methodEvidence: evidence("art-method-control", methodText, "repository://data/method/knowledge.json"), supportingEvidence: [sitemap],
    spec: { schemaVersion: 1, methodRouteId: ENGINEERING_METHOD_ID, methodVersion: JSON.parse(methodText).version,
      methodArtifactId: "art-method-control", validation: { resultId: "wr-method-validation-control", attemptId: "at-method-validator-control", verdict: "PASS", validatedAspect: "SOURCE_EXTRACTION" },
      supportingArtifactIds: [sitemap.artifactId], existingInterface: { id: "streamline-sitemap-inventory", version: 1 },
      expectedBehavior: ["Inventory dated same-publisher page routes with source spans and no meeting truth promotion."],
      proof: { timeoutMs: 2000, cases: [{ artifactId: sitemap.artifactId, subjectId: "test:corona", publisherOrigin: site, minimumRows: 1,
        expectedEntries: [{ sourceUrl, dateFromPath: "2026-09-01" }] }] } },
  };
}

test("Engineering compiles a current proven method to reproducible review-only implementation and executable tests", async () => {
  const result = await runEngineeringWorker(request());
  assert.equal(result.verdict, "CANDIDATE_PROVED", JSON.stringify(result.findings));
  assert.equal(result.reproducibility.isolatedExecutions, 2);
  assert.equal(result.reproducibility.cases[0].firstOutputHash, result.reproducibility.cases[0].replayOutputHash);
  assert.equal(result.adoption, "INTEGRATION_REVIEW_REQUIRED");
  assert.ok(result.proposedFiles.every(file => contentHash(file.content) === file.contentHash));
  assert.ok(result.affectedPaths.every(path => path.startsWith("review-candidates/")));
  const scratchRoot = mkdtempSync(join(tmpdir(), "wtp-engineering-test-"));
  try {
    for (const file of result.proposedFiles) {
      const target = resolve(scratchRoot, file.path);
      assert.ok(target.startsWith(resolve(scratchRoot) + sep));
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, file.content, "utf8");
    }
    const tested = spawnSync(process.execPath, ["--test", "review-candidates/streamline-sitemap-inventory/inventory.test.mjs"],
      { cwd: scratchRoot, encoding: "utf8", windowsHide: true, timeout: 10000, env: { NODE_ENV: "test" } });
    assert.equal(tested.status, 0, tested.stdout + tested.stderr);
  } finally {
    const target = resolve(scratchRoot);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("wtp-engineering-test-"));
    rmSync(target, { recursive: true, force: true });
  }
});

test("Engineering refuses changed evidence, self-validation, unmeasured methods, and broad capability grants", async () => {
  const input = request();
  const changed = { ...input, supportingEvidence: [{ ...input.supportingEvidence[0], text: "tampered" }] };
  assert.equal((await runEngineeringWorker(changed)).verdict, "REFUSED");
  const self = { ...input, spec: { ...input.spec, validation: { ...input.spec.validation, attemptId: input.attemptId } } };
  assert.equal((await runEngineeringWorker(self)).verdict, "REFUSED");
  const unproven = JSON.parse(methodText);
  unproven.routes.find((route: { id: string }) => route.id === ENGINEERING_METHOD_ID).outcomes = [];
  assert.equal((await runEngineeringWorker({ ...input, methodEvidence: evidence(input.methodEvidence.artifactId, JSON.stringify(unproven), input.methodEvidence.canonicalUrl) })).verdict, "REFUSED");
  const broad = defaultGrant({ role: "ENGINEERING", project: "engineering-control", policyVersion: "test", grantedAt: STAMP });
  const denied = await runEngineeringWorker({ ...input, grant: broad });
  assert.equal(denied.verdict, "REFUSED");
  assert.equal(denied.proposedFiles.length, 0);
  assert.match(denied.findings[0].detail, /GRANT_EXCEEDS/);
});

test("Engineering preserves failed expectations as failed proof with no adoptable candidate", async () => {
  const input = request();
  const result = await runEngineeringWorker({ ...input, spec: { ...input.spec, proof: { ...input.spec.proof,
    cases: input.spec.proof.cases.map(item => ({ ...item, minimumRows: 2 })) } } });
  assert.equal(result.verdict, "PROOF_FAILED");
  assert.equal(result.proposedFiles.length, 0);
  assert.equal(result.reproducibility.verdict, "FAIL");
  assert.equal(result.reproducibility.cases[0].returnedCount, 1);
});

test("method implementation proof retains an inconclusive civic verification and requires explicit extraction validation", async () => {
  const input = request();
  const result = await runEngineeringWorker({ ...input, spec: { ...input.spec, validation: { ...input.spec.validation, verdict: "INCONCLUSIVE" } } });
  assert.equal(result.verdict, "CANDIDATE_PROVED");
  assert.equal(result.adoption, "INTEGRATION_REVIEW_REQUIRED");
  const invalid = { ...input, spec: { ...input.spec, validation: { ...input.spec.validation, validatedAspect: "UNVERIFIED" } } } as unknown as EngineeringWorkerInput;
  assert.equal((await runEngineeringWorker(invalid)).verdict, "REFUSED");
});

test("Engineering treats zero and malformed sitemap extraction as no proof, never absence", async () => {
  const input = request();
  for (const xml of ["<urlset></urlset>", "<urlset><url><loc>unfinished</loc></urlset>"]) {
    const result = await runEngineeringWorker({ ...input, supportingEvidence: [evidence(input.supportingEvidence[0].artifactId, xml, input.supportingEvidence[0].canonicalUrl)] });
    assert.notEqual(result.verdict, "CANDIDATE_PROVED");
    assert.equal(result.proposedFiles.length, 0);
    assert.equal(result.adoption, "INTEGRATION_REVIEW_REQUIRED");
  }
});
