import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { HeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-enrichment.ts";
import { publishHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-publication.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { factDb } from "./helpers/fact-db.ts";
import { storeVerifiedPortrait } from "../lib/photos/store.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";

const NOW = new Date("2026-10-20T07:00:00.000Z");
const URL = "https://council.example.gov/ada";
const BODY = "ocd-division/country:us/state:az/place:example#council";
const subject: HeldSubjectDetails = { subjectId: "held-member:ada", subjectKind: "official", bodyId: BODY, bodyName: "Council",
  personId: "held-person:ada", heldMemberId: "held-member:ada", personName: "Ada Sample", officeTitle: "Councilmember", governmentId: null,
  sourceUrl: URL, sourceUrls: [URL], profileUrls: [URL], divisionIds: [BODY.split("#")[0]!], checklistIds: ["OFF-09", "OFF-06"],
  needsMembers: false, label: "Ada Sample, Councilmember", checkedAt: NOW.toISOString() };
const html = '<main><h1>Ada Sample</h1><p>Phone: 520-555-0123</p><p>Email: ada@example.gov</p><p>Term ends: 2028</p></main>';
const capture = (at = NOW.toISOString()): WorkerPublicationCapture => ({ httpStatus: 200, transport: "REACHABLE", partial: false, observedAt: at,
  evidence: { artifactId: "raw:ada", contentHash: `sha256-${createHash("sha256").update(html).digest("hex")}`, text: html,
    acquiredByAttemptId: "read-ada", canonicalUrl: URL, retrievedAt: at, sourceId: "council.example.gov", methodRouteId: "held-subject-details" } });

test("one held official's verified contact and term facts publish with their saved copy", async () => {
  const db = await factDb();
  try {
    const purged: string[][] = [];
    const result = await publishHeldSubjectDetails({ subject, capture: capture(), db, clocks: factClocks(null), now: NOW,
      purge: async tags => { purged.push([...tags]); return { purged: true }; } });
    assert.equal(result.refused, null);
    const rows = await db.query(`SELECT f.field,f.value,s.url,f.quote FROM fact f JOIN source_copy s ON s.id=f.source_copy_id
      WHERE f.entity_id=$1 AND f.status='live' ORDER BY f.field`, [subject.personId]);
    assert.deepEqual(rows.map(row => [row.field, row.value]), [["email", "ada@example.gov"], ["phone", "520-555-0123"], [`term_end:${BODY}`, "2028"]]);
    assert.ok(rows.every(row => row.url === URL && html.includes(String(row.quote).replace(/<[^>]*>/g, ""))));
    assert.deepEqual(purged, [["reader-state:AZ"]]);
    assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE entity_id<>$1", [subject.personId]))[0]!.n, 0);
    const confirmed = await publishHeldSubjectDetails({ subject, capture: capture(), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.ok(confirmed.facts.every(fact => "decision" in fact.outcome && fact.outcome.decision === "CONFIRM"));
  } finally { await db.pg.close(); }
});

test("contact beyond its check window stays owed while an independently current term publishes", async () => {
  const db = await factDb();
  try {
    const result = await publishHeldSubjectDetails({ subject, capture: capture("2026-10-19T07:00:00.000Z"), db,
      clocks: { windowHours: kind => kind === "contact" ? 1 : 720, retryMinutes: () => 5 }, now: NOW, purge: async () => ({ purged: true }) });
    assert.equal(result.facts.filter(fact => "blank" in fact.outcome).length, 2);
    assert.deepEqual((await db.query("SELECT field FROM fact WHERE status='live'")).map(row => row.field), [`term_end:${BODY}`]);
    assert.equal((await db.query("SELECT count(*)::int n FROM blank WHERE stage='CHECK'"))[0]!.n, 2);
    const refused = await publishHeldSubjectDetails({ subject, capture: { ...capture(), partial: true }, db, clocks: factClocks(null), now: NOW });
    assert.equal(refused.refused, "HELD_DETAIL_CAPTURE_INCOMPLETE");
    assert.equal((await db.query("SELECT count(*)::int n FROM fact"))[0]!.n, 1);
  } finally { await db.pg.close(); }
});

test("a held government keeps its own name when its governing body has a different name", async () => {
  const db = await factDb();
  try {
    const government = { ...subject, subjectId: "held-government:sample", subjectKind: "government" as const,
      governmentId: "held-government:sample", personId: null, personName: null, label: "City of Sample", bodyName: "City Council" };
    const body = "<main><h1>City of Sample</h1><p>Office address: 10 Public Plaza</p></main>";
    const source = capture();
    const result = await publishHeldSubjectDetails({ subject: government, db, clocks: factClocks(null), now: NOW,
      capture: { ...source, evidence: { ...source.evidence, text: body, contentHash: `sha256-${createHash("sha256").update(body).digest("hex")}` } },
      purge: async () => ({ purged: true }) });
    assert.equal(result.refused, null);
    assert.deepEqual(await db.query("SELECT kind,name FROM entity WHERE id=$1", [government.subjectId]), [{ kind: "government", name: "City of Sample" }]);
    assert.deepEqual((await db.query("SELECT field FROM fact WHERE status='live' ORDER BY field")).map(row => row.field), ["name", "office_address"]);
  } finally { await db.pg.close(); }
});

test("a known congressional subject retains its native identity on the canonical person", async () => {
  const db = await factDb();
  try {
    const official = { ...subject, subjectId: "congress:A000001", personId: "person:ada" };
    await publishHeldSubjectDetails({ subject: official, capture: capture(), db, clocks: factClocks(null), now: NOW,
      purge: async () => ({ purged: true }) });
    assert.deepEqual(await db.query("SELECT entity_id,scheme,value FROM entity_external_id WHERE scheme='bioguide'"),
      [{ entity_id: "person:ada", scheme: "bioguide", value: "A000001" }]);
    assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE entity_id=$1 AND status='live'", ["person:ada"]))[0]!.n, 3);
  } finally { await db.pg.close(); }
});

test("a profile portrait uses the existing image verifier and stored bytes before its fact publishes", async () => {
  const db = await factDb();
  try {
    const body = html.replace("</main>", '<img src="https://council.example.gov/ada.jpg" alt="Ada Sample portrait"></main>');
    const source = capture(), writes: string[] = [];
    const image = await sharp({ create: { width: 160, height: 180, channels: 3, background: "navy" } }).png().toBuffer();
    const captured = { ...source, evidence: { ...source.evidence, text: body,
      contentHash: `sha256-${createHash("sha256").update(body).digest("hex")}` } };
    const result = await publishHeldSubjectDetails({ subject, db, clocks: factClocks(null), now: NOW, capture: captured,
      purge: async () => ({ purged: true }), storePortrait: (id, sources, at, signal) => storeVerifiedPortrait(id, sources, at, {
        read: async () => ({ bytes: image, retrievedAt: NOW.toISOString(), contentType: "image/png" }),
        put: async key => { writes.push(key); },
      }, "officials", signal) });
    assert.equal(result.refused, null);
    assert.equal(writes.length, 1);
    const [portrait] = await db.query("SELECT value FROM fact WHERE entity_id=$1 AND field='portrait' AND status='live'", [subject.personId]);
    assert.ok(portrait);
    assert.ok(portraitBindingMatches(subject.personId!, portrait!.value as Parameters<typeof portraitBindingMatches>[1]));
    const failed = await publishHeldSubjectDetails({ subject, db, clocks: factClocks(null), now: NOW, capture: captured,
      purge: async () => ({ purged: true }), storePortrait: async () => { throw new Error("PORTRAIT_IMAGE_NOT_DECODED"); } });
    assert.ok(failed.facts.some(fact => fact.field === "phone" && "decision" in fact.outcome && fact.outcome.decision === "CONFIRM"));
    assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE field='portrait' AND status='live'"))[0]!.n, 1, "failed refresh preserves the verified portrait");
    assert.equal((await db.query("SELECT reason FROM blank WHERE field='portrait'"))[0]!.reason, "PORTRAIT_NOT_VERIFIED");
  } finally { await db.pg.close(); }
});
