import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import {
  crosswalkEvidenceWorkItem,
  indexVault,
  READ_ONLY_VAULT_PROJECT,
  readHeldBytes,
} from "../lib/control-plane/evidence/read-only-vault.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";

/**
 * **THE VAULT, READ BY A ROUTINE CHILD THAT MAY NOT WRITE.** (C16, 2026-09-24.)
 *
 * The derived wiring child reads the evidence vault through a module with no write verb: what the durable store
 * committed is indexed by artifact id, by content, and by the work item a crosswalk's evidence is filed under, and
 * every read proves its bytes.
 */
test("C16: the read-only vault finds what the durable store committed, by id, content and work item, and proves the bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-ro-vault-"));
  try {
    const body = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    const { artifact } = recordAcquisition({
      canonicalUrl: "https://www.example.gov/feed.ics", retrievedAt: "2026-09-24T20:00:00.000Z", httpStatus: 200,
      contentType: "text/calendar", sourceId: "meeting-body-crosswalk", methodRouteId: "crosswalk:evidence",
      workItemId: crosswalkEvidenceWorkItem("f".repeat(64)), attemptId: "crosswalk:x", permission: "ALLOWED", transport: "REACHABLE",
    }, body);
    const { key } = await putArtifact(new DurableEvidenceStore(root), READ_ONLY_VAULT_PROJECT, artifact, Buffer.from(body, "utf8"));

    const index = await indexVault(root);
    const held = index.byId.get(artifact.id);
    assert.ok(held, "found by its artifact id");
    assert.equal(index.byHash.get(artifact.contentHash.slice("sha256-".length))?.id, artifact.id);
    assert.equal(index.byWorkItem.get(crosswalkEvidenceWorkItem("f".repeat(64)))?.[0]?.id, artifact.id);
    assert.equal(held.tier, "RAW");
    assert.equal(new TextDecoder().decode(await readHeldBytes(held)), body);

    /* A body that no longer hashes to its commitment is a failed read, never a document. */
    writeFileSync(held.bodyPath, "tampered");
    await assert.rejects(() => readHeldBytes(held), /VAULT_BODY_CORRUPTED/);
    assert.ok(readFileSync(`${held.bodyPath}.meta.json`, "utf8").includes(key));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual((await indexVault(join(tmpdir(), "wtp-ro-vault-absent-root"))).byId.size, 0, "an absent root is an empty vault");
});

test("C16: the derived wiring child's closure reaches no filesystem writer", () => {
  const vault = readFileSync("lib/control-plane/evidence/read-only-vault.ts", "utf8");
  assert.doesNotMatch(vault, /\b(writeFile|rename|mkdir|rm|appendFile|unlink)\b\s*\(/);
  assert.doesNotMatch(vault, /durable-store/);
  const child = readFileSync("scripts/derive-meeting-source-wiring.mts", "utf8");
  assert.doesNotMatch(child, /durable-store|DurableEvidenceStore|writeFile|appendFile/);
});
