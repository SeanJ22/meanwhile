import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinedCampaignSourceRows } from "../lib/funding/state-source-join.ts";
import { campaignFinanceSource } from "../lib/funding/state-sources.ts";

test("source-native campaign joins preserve Unicode line separators in both source tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "campaign-source-separators-"));
  try {
    const filings = join(root, "filings.csv"), covers = join(root, "covers.csv");
    const note = "Source text\u2028continued\u2029unchanged", committee = "Filed\u2028committee";
    await writeFile(filings, `id,note\n1,"${note}"\n`);
    await writeFile(covers, `id,committee\n1,"${committee}"\n`);
    const resource = { ...campaignFinanceSource("WA").resources[0], kind: "CSV" as const,
      lookup: { url: "https://example.gov/covers.csv", keys: ["id"], fields: ["committee"] } };
    const chunks: Uint8Array[] = [];
    for await (const chunk of joinedCampaignSourceRows(filings, resource, join(root, "join"), new AbortController().signal, covers)) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), [{ id: "1", note, committee }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
