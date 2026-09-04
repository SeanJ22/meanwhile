/** Correlate real reader gestures to their actual component classes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const reportPath = "docs/evidence/reader-last-mile-render.json";
const federalPath = "docs/evidence/reader-last-mile-render-federal-money.json";
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const federal = JSON.parse(readFileSync(federalPath, "utf8"));
const requirements = JSON.parse(readFileSync("docs/evidence/reader-last-mile-witness-requirements.json", "utf8")).requirements as { surface: string; component: string; importReach: boolean }[];
const head = report.exactHead ?? report.results[0].build.commit;
assert.ok(report.results.every((row: any) => row.result === "PASS" && row.build.commit === head));
assert.ok(federal.results.every((row: any) => row.result === "PASS" && row.build.commit === head));
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
  "agenda-section": ["85701-phone-dark", ["legistar-pima-1822-minutes", "legistar-pima-1827-comment-access", "diligent-tusd1-493-publication-index"]],
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
  const resultIndex = from.results.findIndex((result: any) => result.label === label);
  const selectedResult = from.results[resultIndex];
  const independent = leaf === "official-popup" ? {
    independentLeaves: ["RecentVoteRecords", "BillPlainSummary"],
    heldBillSummary: selectedResult[row.surface === "ballot" ? "ballotFederalRecords" : "mapFederalRecords"].billSummary,
    gesture: "Open Voting Record; verify all recent rows and the visible held plain-language bill summary, opening its disclosure if necessary.",
  } : {};
  if (leaf === "official-popup") assert.ok(independent.heldBillSummary?.visible, "Independent bill-summary leaf must be verified by this actual run");
  return [{ ...row, ...independent, exactHead: head, evidencePath, evidenceSha256: hash(evidencePath), resultPointer: `/results/${resultIndex}`, screenshots, status: "PROVEN", boundary: "Actual gestures and returned identity/value/count assertions. Component-class witness supplements exhaustive native-record and actual-leaf proof; it does not claim all records fit in one screenshot." }];
});
assert.equal(witnesses.length, requirements.filter(row => row.importReach && !row.component.endsWith("/candidate-card.tsx")).length);
writeFileSync("docs/evidence/reader-last-mile-finance-witnesses.json", JSON.stringify(witnesses, null, 2) + "\n");
console.log(JSON.stringify({ exactHead: head, witnessedClasses: witnesses.length, parentOwnedClasses: ["ballot/components/ballot/candidate-card.tsx"] }));
