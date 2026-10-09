import assert from "node:assert/strict";
import test from "node:test";
import { incumbentHolderFor } from "../lib/ballot/incumbent-record.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { seatHolderById, seatHoldersForDivision } from "../lib/registry/server.ts";
import { registryTransferImport, syntheticFederalDirectory, syntheticStateLegislators } from "./helpers/promoted-fixtures.ts";
import { GET as representation } from "../app/api/representation/[...division]/route.ts";

test("a federal person and division remain readable without a registry or candidacy bridge", async () => {
  const value = syntheticFederalDirectory();
  const person = value.roster.officeholders[0];
  const division = value.roster.divisions.find(row => row.officeholderId === person.id)!.ocdId;
  await withReaderAuthorityEdge({ edgeOnly: true, federalDirectory: { value, versionId: "test:federal-only" } }, async () => {
    assert.equal((await seatHolderById(person.id))?.name, person.name);
    assert.equal((await incumbentHolderFor(person.id))?.id, person.id);
    assert.ok((await seatHoldersForDivision(division)).some(holder => holder.id === person.id));
    assert.equal(await incumbentHolderFor("congress:Z999999"), null);
    const response = await representation(new Request(`https://example.test/api/representation/${division}`), {
      params: Promise.resolve({ division: division.split("/") }),
    });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.holderStatus, "HELD");
    assert.equal(answer.metadataStatus, "HOLDING_UNAVAILABLE");
    assert.equal(answer.label, null);
    assert.ok(answer.holders.some((holder: { id: string }) => holder.id === person.id));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
});

test("a state executive remains readable when the federal directory is unavailable", async () => {
  const { projection } = registryTransferImport();
  const executive = projection.payload.statewideExecutives[0];
  await withReaderAuthorityEdge({ edgeOnly: true, registryRuntime: { value: projection.payload, versionId: projection.versionId } }, async () => {
    assert.equal((await seatHolderById(executive.holder.id))?.name, executive.holder.name);
    const holders = await seatHoldersForDivision(executive.stateOcdId);
    assert.ok(holders.some(holder => holder.id === executive.holder.id));
    assert.ok(holders.every(holder => holder.id.startsWith("statewide:")));
    await assert.rejects(() => seatHoldersForDivision("ocd-division/country:us"));
  });
});

test("a direct state person reaches a ballot card without opening the registry bridge", async () => {
  const value = syntheticStateLegislators("US-NJ");
  const person = value.roster.officeholders[0];
  await withReaderAuthorityEdge({ edgeOnly: true, stateLegislators: { jurisdictions: new Set(["US-NJ"]), load: async jurisdiction => {
    assert.equal(jurisdiction, "US-NJ");
    return { value, versionId: "test:state-only" };
  } } }, async () => {
    assert.equal((await incumbentHolderFor(person.id))?.name, person.name);
    const division = value.roster.divisions.find(row => row.officeholderId === person.id)!.ocdId;
    const response = await representation(new Request(`https://example.test/api/representation/${division}`), {
      params: Promise.resolve({ division: division.split("/") }),
    });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.holderStatus, "HELD");
    assert.equal(answer.metadataStatus, "HOLDING_UNAVAILABLE");
    assert.deepEqual(answer.rosterGaps, []);
    assert.ok(answer.holders.some((holder: { id: string }) => holder.id === person.id));
  });
});

test("an unavailable division authority remains a failure rather than an empty roster", async () => {
  await withReaderAuthorityEdge({ edgeOnly: true }, async () => {
    await assert.rejects(() => seatHolderById("congress:Z999999"));
    await assert.rejects(() => seatHoldersForDivision("ocd-division/country:us/state:az"));
  });
});
