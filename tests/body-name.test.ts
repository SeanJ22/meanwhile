import assert from "node:assert/strict";
import test from "node:test";
import { governingBodyNameOn } from "../lib/facts/body-name.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishBodyFacts, publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { readBodyFacts } from "../lib/facts/registry-overlay.ts";
import { ensureEntity } from "../lib/facts/entities.ts";
import { factDb } from "./helpers/fact-db.ts";

const NOW = new Date("2026-08-14T19:00:00Z");
const TOWN = "ocd-division/country:us/state:al/place:maplesville";
const GOVERNING = `${TOWN}#governing`;

const capture = (text: string, id: string): WorkerPublicationCapture => ({ evidence: { artifactId: id, contentHash: `sha256-${"c".repeat(63)}${id.slice(-1)}`, text, acquiredByAttemptId: "attempt",
  canonicalUrl: "https://www.maplesvilleal.gov/council", retrievedAt: "2026-08-14T12:00:00Z", sourceId: "maplesvilleal.gov", methodRouteId: "held" },
observedAt: "2026-08-14T12:00:00Z", httpStatus: 200, transport: "REACHABLE", partial: false });

test("a page's own name for the governing board is read as written, the one it uses most; a page that does not name it gives none", () => {
  assert.equal(governingBodyNameOn("Maplesville Town Council meets monthly. The Town Council agenda. See the City Council of another place once.", GOVERNING)?.name, "Town Council");
  assert.equal(governingBodyNameOn("Meet the Board of County Commissioners and the mayor", "al:county:county-of-clarke#governing")?.name, "Board of County Commissioners");
  assert.equal(governingBodyNameOn("The Board of Education met. School Board agendas. School Board members.", "al:school:x#board")?.name, "School Board");
  assert.equal(governingBodyNameOn("Welcome to Maplesville. Contact the clerk.", GOVERNING), null);
  assert.equal(governingBodyNameOn("Town Council", `${TOWN}#body:planning`), null, "only a government's governing board is named this way");
  assert.match(governingBodyNameOn("filler ".repeat(30) + "Town Council" + " filler".repeat(30), GOVERNING)!.quote, /Town Council/);
});

test("a roster and a body-facts publication give a governing board a verified, sourced name when its page states one, and never invent one", async t => {
  const db = await factDb(); t.after(() => db.pg.close());
  const body = { id: GOVERNING, name: "Maplesville town governing", state: "AL", parentId: null };
  await ensureEntity(db.query, { id: "al:city:town-of-maplesville", kind: "government", name: "Town of Maplesville", state: "AL", parentId: null });
  const page = "Town of Maplesville. The Town Council: Mayor Pat Doe and Council Member Lee Roe. Town Council meets the first Monday.";
  await publishRosterFacts(db, { body, capture: capture(page, "ar-one"), members: [{ recordId: "m1", fields: { name: "Pat Doe", office: "Mayor" } }], complete: false, producedBy: "box" }, factClocks(null), NOW);
  const [named] = await readBodyFacts(db.query, [GOVERNING]);
  assert.equal(named.fields.name, "Town Council");
  assert.equal(named.fields.provenance?.sourceUrl, "https://www.maplesvilleal.gov/council");

  const other = { id: `${TOWN}x#governing`, name: "Mapleville town governing", state: "AL", parentId: null };
  const plain = "Town of Maplesville. Mayor Pat Doe and Lee Roe lead the town.";
  await publishRosterFacts(db, { body: other, capture: capture(plain, "ar-two"), members: [{ recordId: "m1", fields: { name: "Pat Doe", office: "Mayor" } }], complete: false, producedBy: "box" }, factClocks(null), NOW);
  assert.deepEqual(await db.query("SELECT 1 FROM fact WHERE entity_id = $1 AND field = 'name'", [other.id]), [], "no stated name, so the name stays open");

  const third = { id: `${TOWN}y#governing`, name: "Third town governing", state: "AL", parentId: null };
  await ensureEntity(db.query, { ...third, kind: "body" });
  await publishBodyFacts(db, { bodyId: third.id, capture: capture("Town of Maplesville Town Council office: (334) 555-0100. Town Council clerk.", "ar-three"), producedBy: "box",
    facts: [{ field: "office_phone", value: "(334) 555-0100", quote: "office: (334) 555-0100" }] }, factClocks(null), NOW);
  assert.equal((await db.query("SELECT value_text FROM fact WHERE entity_id = $1 AND field = 'name' AND status = 'live'", [third.id]))[0]?.value_text, "Town Council");
});
