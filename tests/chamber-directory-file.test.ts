import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAMBER_DIRECTORY_URLS, parseChamberDirectory } from "../lib/officials/chamber-directory.ts";
import { readChamberDirectoryFile } from "../lib/officials/chamber-directory-file.ts";

const retrievedAt = "2026-10-18T03:15:00.000Z";

test("streamed chamber XML retains only the state's original contact and vacancy records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-chamber-records-"));
  try {
    const house = await readFile(new URL("./fixtures/sh-01-house-contacts.xml", import.meta.url), "utf8");
    const own = house.slice(house.indexOf("<member>"), house.indexOf("</member>") + 9);
    const original = parseChamberDirectory({ body: house, finalUrl: CHAMBER_DIRECTORY_URLS.house, retrievedAt }, "CA");
    const foreign = '<member><statedistrict>WA01</statedistrict><bioguideID>B000002</bioguideID><official-name>Foreign source member</official-name><phone>202-000-0000</phone></member>';
    const outputs: string[] = [];
    for (const count of [1, 2_000]) {
      const path = join(directory, `source-${count}.xml`), file = await open(path, "w");
      try {
        await file.write("<MemberData>\n");
        for (let index = 0; index < count; index++) await file.write(foreign + "\n");
        await file.write(own + "\n</MemberData>");
      } finally { await file.close(); }
      const selected = await readChamberDirectoryFile({ path, finalUrl: CHAMBER_DIRECTORY_URLS.house, retrievedAt }, "CA");
      assert.ok(selected); assert.doesNotMatch(selected.body, /Foreign source member|WA01/);
      assert.deepEqual(parseChamberDirectory(selected, "CA").offices, new Map([["congress:G000607", original.offices.get("congress:G000607")!]]));
      outputs.push(selected.body);
    }
    assert.equal(outputs[0], outputs[1], "the held state projection does not grow when other states' source records grow");
    const path = join(directory, "whole-source.xml"); await writeFile(path, house);
    const vacancy = await readChamberDirectoryFile({ path, finalUrl: CHAMBER_DIRECTORY_URLS.house, retrievedAt }, "FL");
    assert.ok(vacancy); assert.deepEqual(parseChamberDirectory(vacancy, "FL").vacancies,
      parseChamberDirectory({ body: house, finalUrl: CHAMBER_DIRECTORY_URLS.house, retrievedAt }, "FL").vacancies);
    const senate = join(directory, "senate.xml");
    await writeFile(senate, await readFile(new URL("./fixtures/sh-01-senate-contacts.xml", import.meta.url)));
    assert.equal(await readChamberDirectoryFile({ path: senate, finalUrl: CHAMBER_DIRECTORY_URLS.senate, retrievedAt }, "CA"), null,
      "a valid feed with no applicable facts confirms the existing state projection without fabricating a member");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("streamed chamber reads refuse an incomplete national XML envelope or member", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-chamber-invalid-"));
  try {
    const path = join(directory, "source.xml");
    for (const body of ["<MemberData><member><statedistrict>CA01</statedistrict>", "<MemberData><member></member>", "<html>unavailable</html>"]) {
      await writeFile(path, body);
      await assert.rejects(readChamberDirectoryFile({ path, finalUrl: CHAMBER_DIRECTORY_URLS.house, retrievedAt }, "CA"), /XML_INVALID/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
