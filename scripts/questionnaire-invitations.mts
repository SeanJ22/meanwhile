/**
 * Derive and report the unsent Morris questionnaire plan from the canonical
 * BALLOT_FILING projection. This command sends nothing and writes nothing.
 * Actual delivery, if separately authorized, records its act in the existing
 * operational questionnaire store; a clerk revision never rewrites Git.
 */

import { questionsFor, type OfficeClass } from "../lib/questionnaire/instrument.ts";
import { buildQuestionnaireInvitationPlan } from "../lib/questionnaire/invitation-plan.ts";
import { readNjMorrisFiling } from "../lib/sources/ballot-nj-morris/index.ts";

const PLANNED_INVITED_ON = "2026-09-08";
const PLANNED_REMINDERS_ON = ["2026-09-22", "2026-10-06"] as const;
const DEADLINE = "2026-10-13";

if (process.argv.includes("--write") || process.argv.includes("--check")) {
  throw new Error(
    "The tracked questionnaire invitation artifact is retired; this operation derives a report from canonical BALLOT_FILING data and never writes Git.",
  );
}

const read = await readNjMorrisFiling({ bypassCache: true });
if (read.kind === "STORE_UNREACHABLE") throw new Error(read.detail);
if (read.kind === "NOT_RECORDED") throw new Error("No canonical or bootstrap Morris filing is available.");

const plan = buildQuestionnaireInvitationPlan({
  ballot: read.value.ballot,
  contacts: read.value.contacts,
  plannedInvitedOn: PLANNED_INVITED_ON,
  plannedRemindersOn: PLANNED_REMINDERS_ON,
  deadline: DEADLINE,
});

console.log("questionnaire invitations — NJ Morris 2026 — derived operational report");
console.log(`  canonical read                       ${read.kind}`);
console.log(`  canonical version                    ${read.metadata.versionId}`);
console.log(`  contests                             ${plan.statedContests}`);
console.log(`  candidacies                          ${plan.statedCandidacies}`);
console.log(`  contacts                             ${plan.statedContacts}`);
console.log(`  derivable invitations                ${plan.invitations.length}`);
console.log(`  uninvitable                          ${plan.uninvitable.length}`);
console.log(`  symmetry breaches                    ${plan.symmetryBreaches.length}`);
for (const [basis, count] of Object.entries(plan.basisCounts).sort()) {
  console.log(`  office-class basis ${basis.padEnd(14)} ${count}`);
}
for (const [officeClass, count] of Object.entries(plan.classCounts).sort()) {
  console.log(`  ${officeClass.padEnd(20)} ${count} (${questionsFor(officeClass as OfficeClass).length} questions)`);
}

if (
  plan.invitations.length + plan.uninvitable.length !== plan.statedCandidacies ||
  plan.symmetryBreaches.length > 0
) {
  throw new Error("The derived invitation plan failed its complete-population or equal-effort invariant.");
}

console.log("RCD_DERIVED_OPERATION=" + JSON.stringify({
  sourceId: read.metadata.sourceId,
  sourceVersionId: read.metadata.versionId,
  sourceThrough: read.metadata.sourceThrough,
  readKind: read.kind,
  candidacies: plan.statedCandidacies,
  invitations: plan.invitations.length,
  uninvitable: plan.uninvitable.length,
  symmetryBreaches: plan.symmetryBreaches.length,
  persisted: false,
  sent: false,
}));
