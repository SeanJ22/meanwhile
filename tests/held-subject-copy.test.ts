import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { pageCopy as heldPageCopy, saveCaptureCopy as saveHeldCaptureCopy } from "../lib/facts/source-copy.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factDb } from "./helpers/fact-db.ts";
import { saveReleaseCopy } from "../lib/facts/source-copy.ts";

const URL = "https://source.example.gov/directory", AT = "2026-10-20T07:00:00.000Z";
test("an exact original national capture keeps its immutable receipt while scalar decoding never materializes its records", async () => {
  const body = JSON.stringify([{ name: "Ada Sample", office: "Public\nOffice", nested: { number: 2 } }, { name: "Another Person", enabled: true }]);
  const hash = createHash("sha256").update(body).digest("hex");
  const capture: WorkerPublicationCapture = { observedAt: AT, transport: "REACHABLE", partial: false, httpStatus: 200,
    evidence: { text: body, artifactId: "original-national-directory", contentHash: `sha256-${hash}`, canonicalUrl: URL,
      retrievedAt: AT, acquiredByAttemptId: "original-read", sourceId: "source.example.gov", methodRouteId: "held-subject-details" } };
  const db = await factDb();
  try {
    const parse = JSON.parse;
    let copy;
    try {
      JSON.parse = (value, ...rest) => { assert.ok(!/^[\[{]/.test(value), "the capture normalizer may decode scalar strings only"); return parse(value, ...rest); };
      copy = await saveHeldCaptureCopy(db.query, capture);
    } finally { JSON.parse = parse; }
    assert.equal(copy.finalUrl, URL); assert.equal(copy.fetchedAt.toISOString(), AT);
    assert.ok(copy.text.startsWith(body)); assert.ok(copy.text.includes("Ada Sample\nPublic\nOffice\n2\nAnother Person"));
    assert.deepEqual(await db.query("SELECT url,final_url,sha256,blob_key,http_status FROM source_copy"), [{ url: URL, final_url: URL, sha256: hash, blob_key: "artifact:original-national-directory", http_status: 200 }]);
    assert.equal(capture.evidence.text, body);
    assert.equal((await saveHeldCaptureCopy(db.query,{...capture,observedAt:"2026-10-20T08:00:00.000Z"})).id,copy.id);
    const release={name:"directory",url:URL,sha256:hash,checkedAt:AT,text:body};
    assert.equal((await saveReleaseCopy(db.query,release)).id,copy.id,"another job reuses the saved bytes");
    assert.equal((await saveReleaseCopy(db.query,{...release,checkedAt:"2026-10-21T07:00:00.000Z"})).id,copy.id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM source_copy"))[0].n,1);
  } finally { await db.pg.close(); }
});

test("source text preserves encoded links, calendar values and malformed source bytes", () => {
  const copy = (body: string) => heldPageCopy({ finalUrl: URL, fetchedAt: AT, contentType: "", body });
  assert.ok(copy('<a href="/meetings?body=1&amp;limit=2">Agenda</a>').text.includes("https://source.example.gov/meetings?body=1&limit=2"));
  assert.ok(copy("BEGIN:VCALENDAR\r\nSUMMARY:Council\\, meeting\r\n Continued").text.includes("Council, meetingContinued"));
  assert.equal(copy('[{"name":').text, '[{"name":');
});
