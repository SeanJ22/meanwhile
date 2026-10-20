import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { publishHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-publication.ts";
import type { HeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-enrichment.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { heldSubjectDb } from "./helpers/held-subject-db.ts";
const AT = "2026-10-20T07:00:00.000Z", NOW = new Date(AT), DIVISION = "ocd-division/country:us/state:az/place:sample";
const BODY = `${DIVISION}#council`, SOURCE = "https://sample.example.gov/";
const subject = (overrides: Partial<HeldSubjectDetails>): HeldSubjectDetails => ({ subjectId: BODY, subjectKind: "body", governmentId: null,
  bodyId: BODY, bodyName: "City Council", personId: null, heldMemberId: null, personName: null, officeTitle: null,
  sourceUrl: SOURCE, sourceUrls: [SOURCE], profileUrls: [], divisionIds: [DIVISION], checklistIds: ["GOV-08"], needsMembers: false,
  label: "City Council", checkedAt: null, ...overrides });
const capture = (text: string): WorkerPublicationCapture => ({ httpStatus: 200, transport: "REACHABLE", partial: false, observedAt: AT,
  evidence: { artifactId: "fixture-source", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, text,
    acquiredByAttemptId: "fixture-acquisition", canonicalUrl: SOURCE, retrievedAt: AT, sourceId: "sample.example.gov", methodRouteId: "held-subject-details" } });

test("a special district's actual Director and Board Secretary publish as members while its staff section stays outside the roster", async () => {
  const db = await heldSubjectDb();
  try {
    const held = subject({ subjectId: BODY, subjectKind: "body", governmentId: null, bodyName: "Water District Board of Directors", needsMembers: true });
    const table = (name: string, office: string) => `<tr><td>${name}</td><td>${office}</td></tr>`;
    const page = '<main><h1>Water District Board of Directors</h1><h2>Board members</h2><table><tr><th>Name</th><th>Office</th></tr>' +
      table("Dana Director", "Director") + table("Sam Secretary", "Board Secretary") + '</table><h2>Staff</h2><table><tr><th>Name</th><th>Office</th></tr>' +
      table("Pat Staff", "Executive Director") + table("Casey Clerk", "District Clerk") + '</table></main>';
    const report = await publishHeldSubjectDetails({ subject: held, capture: capture(page), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.equal(report.refused, null);
    const reader = await readFactRosters(db.query, [BODY]);
    assert.deepEqual(reader.rosters[0]!.members.map(member => [member.name, member.officeTitle]).sort(), [["Dana Director", "Director"], ["Sam Secretary", "Board Secretary"]]);
    assert.equal((await db.query("SELECT count(*)::int n FROM entity WHERE name IN ('Pat Staff','Casey Clerk')"))[0]!.n, 0);
  } finally { await db.pg.close(); }
});
