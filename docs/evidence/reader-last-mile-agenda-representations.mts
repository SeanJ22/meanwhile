import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { agendaDocumentRepresentation, classifyAgendaPublication } from "../../lib/ask/agenda-publication.ts";
import { readSnapshot } from "../../lib/meetings/snapshot.ts";
import { floored } from "../../lib/ops/denominator-floor.ts";
import { sha256 } from "../../lib/holdings/reader-census.ts";

const snapshot = readSnapshot();
assert.ok(snapshot);
const documents = snapshot.agendaDocuments ?? [];
floored("agenda representation audit", "every stored agenda document revision", documents.length, documents.length);
const signals = [
  ["DILIGENT_NAVIGATION", /Skip Navigation\s+Jump to SideBar\s+Quick Menu/i],
  ["UNLOADED_CIVICCLERK", /Public Portal\s*[•·-]?\s*CivicClerk[\s\S]*(?:need to enable|requires?) JavaScript/i],
  ["UNLOADED_DRIVE", /Google Drive\s+Loading(?:&hellip;|\.{3}|…)?\s+Sign in/i],
  ["BINARY_DOCUMENT", /^(?:PK\u0003\u0004|%PDF-)|\u0000/],
] as const;
const rows = documents.map(document => {
  const representation = agendaDocumentRepresentation(document);
  const publication = classifyAgendaPublication({ meetingId: document.meetingId, bodyName: "the publisher", documentsForMeeting: [document], documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings, now: 0 });
  const signatures = signals.filter(([, pattern]) => pattern.test(document.text ?? "")).map(([id]) => id);
  return {
    nativeId: document.id, meetingId: document.meetingId, documentUrl: document.documentUrl,
    sourceOrg: document.sourceOrg, retrievedAt: document.retrievedAt,
    acquiredExtractionLabel: document.extraction, textBytesSha256: document.text === null ? null : sha256(document.text),
    representation, signatures, documentSharedAcrossGovernments: publication.documentSharedAcrossGovernments,
    canonicalGovernmentIds: [...new Set(documents.filter(other => other.documentUrl === document.documentUrl).flatMap(other => snapshot.meetings.filter(meeting => meeting.id === other.meetingId).map(meeting => meeting.ocdId)).filter(Boolean))].sort(),
    disposition: publication.documentSharedAcrossGovernments ? "Identity unresolved: the exact stored link spans more than one canonical government. No source text, agenda item or stored publisher attribution may be attached to a body; only the explicit OURS unresolved-link diagnostic may render."
      : representation === "TEXT" ? "Readable source text; item extraction and temporal/revision scope remain independent obligations."
      : representation === "PUBLICATION_PORTAL" ? "Acquired application shell or publisher directory. Only source/identity and the OURS acquisition gap may render, never its navigation/script as a meeting agenda."
        : "Unreadable acquisition, including binary bytes mislabeled as extracted HTML. Meeting identity and source URL remain held; no agenda content is promoted.",
  };
});
const retainedKnownShellSignatures = rows.filter(row => row.representation === "TEXT" && row.signatures.length);
assert.deepEqual(retainedKnownShellSignatures, [], "A successfully extracted label must not turn known application/binary signatures into civic agenda text");
const sourcePaths = ["data/meetings-snapshot.json", "lib/ask/agenda-publication.ts", "docs/evidence/reader-last-mile-agenda-representations.mts"];
const result = {
  exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  executionLevel: "CANONICAL_SELECTOR", sourceHashScope: "Exact working-tree bytes at this execution; the HEAD alone does not claim a clean tree.",
  sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, sha256(readFileSync(path))])),
  rule: "All native acquired document IDs remain inventoried. The exact shared representation classifier is checked against independently enumerated stored shell/binary signatures. Signature absence alone is not reader eligibility or proof of an agenda item.",
  expectedCount: documents.length, returnedCount: rows.length,
  counts: Object.fromEntries([...new Set(rows.map(row => row.representation))].map(kind => [kind, rows.filter(row => row.representation === kind).length])),
  unresolvedGovernmentLinks: rows.filter(row => row.documentSharedAcrossGovernments).length,
  retainedKnownShellSignatures, rows,
};
writeFileSync("docs/evidence/reader-last-mile-agenda-representations.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ expectedCount: result.expectedCount, counts: result.counts, retainedKnownShellSignatures: retainedKnownShellSignatures.length }));
