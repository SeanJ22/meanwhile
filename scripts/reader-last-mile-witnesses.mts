/** Correlate real reader gestures to their actual component classes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { relocatedImageBytes } from "../lib/holdings/evidence-location.ts";
import { relative } from "node:path";
import { floored } from "../lib/ops/denominator-floor.ts";
import type { BillSummary } from "../lib/votes/bill-summaries.ts";
import { readMeetingsProjection, requireReaderProofMeetingsProjection } from "../lib/meetings/snapshot.ts";
import { meetingListingIdentity } from "../lib/meetings/listing-identity.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { commentAccessFor } from "../lib/registry/comment-access.ts";
import { prepareReaderProofRuntime, requiredPreparedReaderProofMeetingsAuthority } from "./lib/reader-proof-runtime.ts";
import { validateListingWitnessReadback } from "./lib/reader-full-reproof.ts";

interface RenderedReaderCase {
  label: string;
  result: "PASS" | "FAIL";
  build?: { commit: string };
  mapFederalRecords?: { billSummary: RenderedBillSummary } | null;
  ballotFederalRecords?: { billSummary: RenderedBillSummary } | null;
  listingMultiplicity?: { renderedListingCount: number; groups: { sourceIds: string[]; sourceListingCount: number; uniqueMeetingCount: null; reason: string }[] } | null;
}
interface RenderedBillSummary extends BillSummary {
  billUrl: string;
  voteId: string;
  actualLeaf: "BillPlainSummary";
  visible: boolean;
}
interface RenderedReaderReport {
  exactHead: string | null;
  buildId: string;
  results: RenderedReaderCase[];
  screenshots: string[];
}

const hash = (path: string) => createHash("sha256").update(relocatedImageBytes(process.cwd(), path) ?? readFileSync(path)).digest("hex");
const reportPath = "docs/evidence/reader-last-mile-render.json";
const federalPath = "docs/evidence/reader-last-mile-render-federal-money.json";
const report = JSON.parse(readFileSync(reportPath, "utf8")) as RenderedReaderReport;
const federal = JSON.parse(readFileSync(federalPath, "utf8")) as RenderedReaderReport;
const requirements = JSON.parse(readFileSync("docs/evidence/reader-last-mile-witness-requirements.json", "utf8")).requirements as { surface: string; component: string; importReach: boolean }[];
const head = report.exactHead ?? report.results[0]?.build?.commit;
assert.ok(head, "Actual reader run must identify its proved commit");
assert.ok(report.results.every(row => row.result === "PASS" && row.build?.commit === head));
assert.ok(federal.results.every(row => row.result === "PASS" && row.build?.commit === head));
await prepareReaderProofRuntime();
const heldMeetings = requireReaderProofMeetingsProjection(await readMeetingsProjection({ bypassCache: true }), requiredPreparedReaderProofMeetingsAuthority()).meetings;
const canonicalListingGroups = meetingListingIdentity(heldMeetings, canonicalBodyIdentity).groups
  .filter((group) => group.sourceIds.some((id) => heldMeetings.find((meeting) => meeting.id === id)?.ocdId?.includes("/state:nh/")))
  .map(({ sourceIds, reason, sourceListingCount, uniqueMeetingCount }) => ({ sourceIds, reason, sourceListingCount, uniqueMeetingCount }));
const cases: Record<string, [string, string[]]> = {
  "person-identity": ["85701-desktop-light", ["map-money", "ballot-money"]],
  "contact-pills": ["85701-desktop-light", ["map-money", "ballot-money"]],
  "official-term-note": ["85641-phone-dark", ["official-term-note"]],
  "roster-completeness-gap": ["07866-desktop-dark", ["incomplete-roster", "district-popup"]],
  "entity-modal": ["07866-desktop-dark", ["incomplete-roster", "incomplete-roster-last-member"]],
  "meeting-panel": ["85701-phone-dark", ["venue-meeting-panel"]],
  "shuffled-facts": ["85641-phone-dark", ["about-area"]],
  "polling-lookup-fallback": ["85701-phone-dark", ["ballot-voting-outside-coverage", "ballot-voting-outside-coverage-last"]],
  "meeting-popup": ["85701-phone-dark", ["meeting-popup"]],
  // tusd1:493 is back in ACQUIRED_IS_PUBLICATION_INDEX (2026-09-23 reader batch).
  // Its stored rows were 54-69 characters of Diligent page header that the reader
  // had shown as the sitting's own agenda text (READ_NO_ITEMS_EXTRACTED). The
  // Diligent reader fix (6fd12d1e) reads every stored shape of a Diligent meeting
  // page as the publisher's agenda portal, so this known-answer witness tracks the
  // -publication-index surface the render now produces for it. The same surface is
  // also proven by apptegy:vail:60703698 (85641) and diligent:newburynh:3367 (03255).
  "agenda-section": ["85701-phone-dark", ["legistar-pima-1822-minutes", "diligent-tusd1-493-publication-index"]],
  "state-money-section": ["85701-desktop-light", ["map-money", "ballot-money"]],
  "candidate-contact": ["07866-desktop-dark", ["ballot-filed-contact"]],
  "funding-section": ["85641-phone-dark", ["map-federal-money", "ballot-federal-money"]],
  "member-directory": ["85641-desktop-dark", ["map-committees", "map-offices", "ballot-committees", "ballot-offices"]],
  "district-popup": ["07866-desktop-dark", ["district-popup"]],
  "official-popup": ["85641-desktop-dark", ["map-recent-votes", "map-recent-votes-last", "ballot-recent-votes", "ballot-recent-votes-last"]],
  "key-votes-section": ["85641-desktop-dark", ["map-key-votes", "map-key-votes-last", "ballot-key-votes", "ballot-key-votes-last"]],
  "voting-sites-panel": ["85701-desktop-light", ["voting-sites", "voting-sites-source", "ballot-voting-sites", "ballot-voting-sites-source"]],
  "official-actions": ["85701-desktop-light", ["map-official-actions", "map-official-actions-last", "ballot-official-actions", "ballot-official-actions-last"]],
  "meeting-records": ["85701-phone-dark", ["legistar-pima-1825-agenda", "legistar-pima-1825-actions", "legistar-pima-1825-rollCalls"]],
  "public-statements-profile": ["85641-desktop-dark", ["map-profile", "ballot-profile"]],
};
const witnesses = requirements.filter(row => row.importReach).flatMap(row => {
  const leaf = row.component.split("/").at(-1)!.replace(/\.tsx$/, "");
  // Parent's exhaustive ballot instrument owns the actual unmodal CandidateCard.
  if (leaf === "candidate-card") return [];
  const selected = cases[leaf];
  assert.ok(selected, `Unmapped executed component ${row.component}`);
  const [label, suffixes] = selected;
  const from = leaf === "funding-section" ? federal : report;
  const evidencePath = leaf === "funding-section" ? federalPath : reportPath;
  const suffixesForSurface = suffixes.filter(suffix => row.surface === "ballot" ? !suffix.startsWith("map-") && (leaf !== "voting-sites-panel" || suffix.startsWith("ballot-")) : row.surface === "map" ? !suffix.startsWith("ballot-") : true);
  assert.ok(suffixesForSurface.length, `No same-surface witness ${row.surface}/${leaf}`);
  const screenshots = suffixesForSurface.map(suffix => {
    const path = from.screenshots.find((path: string) => path.endsWith(`${label}-${suffix}.png`));
    assert.ok(path, `Actual screenshot missing ${label}-${suffix}`);
    return { path: relative(process.cwd(), path).replaceAll("\\", "/"), sha256: hash(path) };
  });
  if (leaf === "agenda-section") {
    // Participation is not shown for concluded meetings. Bind this required
    // subtree to a current future sitting's independently executed browser case.
    const path = "docs/evidence/reader-last-mile-final-render.json";
    const final = JSON.parse(readFileSync(path, "utf8")) as {
      exactHead: string; buildId: string;
      results: { id: string; result: string; meetingId: string; bodyId: string; startsAt: string; expectedLines: string[]; renderedLines: string[]; sourceUrl: string; screenshot: { path: string; sha256: string } }[];
      screenshots: { path: string; sha256: string }[];
    };
    assert.equal(final.exactHead, head);
    assert.equal(final.buildId, report.buildId);
    const index = final.results.findIndex((result) => result.id === "current-participation");
    const participation = final.results[index];
    assert.equal(participation?.result, "PASS", "Current participation must have an actual passing browser case");
    const meeting = heldMeetings.find((meeting) => meeting.id === participation.meetingId);
    assert.ok(meeting && meeting.status !== "CANCELED" && Date.parse(meeting.startsAt) > Date.now());
    assert.equal(participation.bodyId, meeting.bodyId);
    assert.equal(participation.startsAt, meeting.startsAt);
    const access = commentAccessFor(meeting.ocdId, meeting.bodyName, meeting.bodyId);
    assert.ok(access && access.commentPeriod !== "UNKNOWN");
    const lines = [access.commentPeriodDetail, access.timeLimit, access.signup, access.writtenComment, access.attend].filter(Boolean);
    assert.ok(lines.length);
    assert.deepEqual(participation.expectedLines, lines);
    assert.deepEqual(participation.renderedLines, lines);
    assert.equal(participation.sourceUrl, access.sourceUrl);
    assert.ok(final.screenshots.some((shot) => shot.path === participation.screenshot.path && shot.sha256 === participation.screenshot.sha256));
    assert.equal(hash(participation.screenshot.path), participation.screenshot.sha256);
    return [{ ...row, exactHead: head, evidencePath: path, evidenceSha256: hash(path), resultPointer: `/results/${index}`, screenshots: [...screenshots, participation.screenshot], status: "PROVEN", boundary: "Actual current future-sitting participation instructions and source link, plus the executed minutes and agenda-text screenshots. Exhaustive native-record and actual-leaf proofs remain required." }];
  }
  const listingSuffixes = leaf === "meeting-popup" ? canonicalListingGroups.map((_, index) => `listing-popup-${index + 1}`) : leaf === "meeting-panel" ? ["listing-count", "listing-overlay", "listing-venue"] : leaf === "entity-modal" ? ["listing-full-meeting"] : [];
  const listingCase = listingSuffixes.length ? report.results.find(result => result.label === "03255-phone-dark") : null;
  if (listingSuffixes.length) {
    validateListingWitnessReadback(listingCase?.listingMultiplicity?.groups, canonicalListingGroups);
    for (const suffix of listingSuffixes) {
      const path = report.screenshots.find(path => path.endsWith(`03255-phone-dark-${suffix}.png`));
      assert.ok(path, `Actual unresolved calendar-listing screenshot missing ${suffix}`);
      screenshots.push({ path: relative(process.cwd(), path).replaceAll("\\", "/"), sha256: hash(path) });
    }
  }
  const resultIndex = from.results.findIndex(result => result.label === label);
  const selectedResult = from.results[resultIndex];
  assert.ok(selectedResult, `Actual reader result missing ${label}`);
  const independent = leaf === "official-popup" ? {
    independentLeaves: ["RecentVoteRecords", "BillPlainSummary"],
    heldBillSummary: selectedResult[row.surface === "ballot" ? "ballotFederalRecords" : "mapFederalRecords"]?.billSummary,
    gesture: "Open Voting Record; verify all recent rows and the visible held plain-language bill summary, opening its disclosure if necessary.",
  } : {};
  if (leaf === "official-popup") assert.ok(independent.heldBillSummary?.visible, "Independent bill-summary leaf must be verified by this actual run");
  return [{ ...row, ...independent, ...(listingCase ? { listingMultiplicity: listingCase.listingMultiplicity, listingResultPointer: `/results/${report.results.indexOf(listingCase)}` } : {}), exactHead: head, evidencePath, evidenceSha256: hash(evidencePath), resultPointer: `/results/${resultIndex}`, screenshots, status: "PROVEN", boundary: "Actual gestures and returned identity/value/count assertions. Component-class witness supplements exhaustive native-record and actual-leaf proof; it does not claim all records fit in one screenshot." }];
});
const requiredClasses = requirements.filter(row => row.importReach && !row.component.endsWith("/candidate-card.tsx")).length;
floored("executed reader surface classes", "every reachable required class except parent-owned CandidateCard", requiredClasses, witnesses.length);
assert.equal(witnesses.length, requiredClasses);
writeFileSync("docs/evidence/reader-last-mile-finance-witnesses.json", JSON.stringify(witnesses, null, 2) + "\n");
console.log(JSON.stringify({ exactHead: head, witnessedClasses: witnesses.length, parentOwnedClasses: ["ballot/components/ballot/candidate-card.tsx"] }));
