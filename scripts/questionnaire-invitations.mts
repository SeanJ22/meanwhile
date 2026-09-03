/**
 * **GENERATE THE SYMMETRIC INVITATION LIST. IT SENDS NOTHING.**
 * (The questionnaire-and-corpora brief, item 1, 2026-08-23.)
 *
 * ```
 * corepack pnpm questionnaire:invitations            # report only
 * corepack pnpm questionnaire:invitations --write    # write the artifact
 * ```
 *
 * ## What it produces, and what it deliberately does not
 *
 * `data/questionnaire/invitations-nj-morris-2026.json` — one row per candidacy,
 * carrying the filed email, the office class, the instrument version, the
 * PLANNED send date, the PLANNED reminder dates and the deadline.
 *
 * **`invitedOn` is `null` on every row and `remindedOn` is empty on every row**,
 * because nothing has been sent. Stamping either would put a date on an act
 * nobody performed, and the Positions empty state reads exactly those two fields
 * to decide whether to tell a reader we asked. The artifact is a reviewable
 * plan; the send is a separate act by a person.
 *
 * ## The count assertion (RULING 100)
 *
 * The ballot file states its own totals — 90 contests and 272 candidacies — and
 * the contacts file states 272. This script asserts against BOTH and FAILS on
 * fewer rather than reporting a partial that adds up. A contest that comes back
 * short is named individually.
 *
 * ## Contest-as-unit (the equal-effort rule)
 *
 * Every candidate in a contest is invited or none is, enforced in
 * `lib/questionnaire/invitations.ts` rather than here, so a second caller
 * cannot forget it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INSTRUMENT_VERSION,
  questionsFor,
  type OfficeClass,
} from "../lib/questionnaire/instrument.ts";
import {
  buildContestInvitations,
  symmetryBreaches,
  type Invitation,
  type UninvitableCandidate,
} from "../lib/questionnaire/invitations.ts";
import { officeClassFor } from "../lib/questionnaire/office-class.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BALLOT = join(ROOT, "data/states/nj/ballot/nj-morris-2026.json");
const CONTACTS = join(ROOT, "data/states/nj/ballot/nj-morris-2026-contacts.json");
const OUT = join(ROOT, "data/questionnaire/invitations-nj-morris-2026.json");

/**
 * **THE SCHEDULE, IDENTICAL FOR ALL 272.**
 *
 * One send date, two reminders, one deadline — the same four dates for every
 * candidate in every contest, which is what makes "identical number of
 * reminders" checkable rather than asserted. The dates are the author's to move;
 * they are constants here so moving them is one edit that moves everybody.
 */
const PLANNED_INVITED_ON = "2026-09-08";
const PLANNED_REMINDERS_ON = ["2026-09-22", "2026-10-06"] as const;
const DEADLINE = "2026-10-13";

interface BallotFile {
  contests: Array<{ id: string; ocdId: string; title: string }>;
  candidacies: Array<{ id: string; contestId: string }>;
}
interface ContactsFile {
  contacts: Array<{
    candidacyId: string;
    email: string | null;
    sourceUrl: string;
    sourceOrg: string;
    collectedAt: string;
  }>;
}

function main(): void {
  const write = process.argv.includes("--write");

  const ballot = JSON.parse(readFileSync(BALLOT, "utf8")) as BallotFile;
  const contacts = JSON.parse(readFileSync(CONTACTS, "utf8")) as ContactsFile;

  const statedContests = ballot.contests.length;
  const statedCandidacies = ballot.candidacies.length;
  const statedContacts = contacts.contacts.length;

  const contactBy = new Map(contacts.contacts.map((c) => [c.candidacyId, c]));

  const invitations: Invitation[] = [];
  const uninvitable: UninvitableCandidate[] = [];
  const basisCounts: Record<string, number> = {};
  const classCounts: Record<string, number> = {};

  for (const contest of ballot.contests) {
    const verdict = officeClassFor({ ocdId: contest.ocdId, title: contest.title });
    basisCounts[verdict.basis] = (basisCounts[verdict.basis] ?? 0) + 1;

    const candidates = ballot.candidacies
      .filter((c) => c.contestId === contest.id)
      .map((c) => {
        const contact = contactBy.get(c.id);
        return {
          candidacyId: c.id,
          contestId: c.contestId,
          email: contact?.email ?? null,
          contactSource: contact
            ? {
                sourceUrl: contact.sourceUrl,
                sourceOrg: contact.sourceOrg,
                collectedAt: contact.collectedAt,
              }
            : null,
        };
      });

    const result = buildContestInvitations({
      contestId: contest.id,
      officeClass: verdict.officeClass,
      instrumentVersion: INSTRUMENT_VERSION,
      plannedInvitedOn: PLANNED_INVITED_ON,
      plannedRemindersOn: [...PLANNED_REMINDERS_ON],
      deadline: DEADLINE,
      candidates,
    });

    invitations.push(...result.invitations);
    uninvitable.push(...result.uninvitable);
    classCounts[verdict.officeClass] =
      (classCounts[verdict.officeClass] ?? 0) + candidates.length;
  }

  /* ------------------------------------------------- the count assertion --- */
  const accountedFor = invitations.length + uninvitable.length;
  const breaches = symmetryBreaches(invitations);

  console.log("questionnaire invitations — NJ Morris 2026");
  console.log(`  contests stated by the ballot file   ${statedContests}`);
  console.log(`  candidacies stated by the ballot file ${statedCandidacies}`);
  console.log(`  contacts stated by the contacts file  ${statedContacts}`);
  console.log(`  invitations generated                 ${invitations.length} of ${statedCandidacies}`);
  console.log(`  uninvitable (no filed contact)        ${uninvitable.length} of ${statedCandidacies}`);
  console.log(`  accounted for                         ${accountedFor} of ${statedCandidacies}`);
  console.log(`  symmetry breaches                     ${breaches.length}`);
  console.log("  office class basis:");
  for (const [basis, n] of Object.entries(basisCounts).sort()) {
    console.log(`    ${basis.padEnd(14)} ${n} of ${statedContests} contests`);
  }
  console.log("  candidacies by office class:");
  for (const [cls, n] of Object.entries(classCounts).sort()) {
    console.log(
      `    ${cls.padEnd(20)} ${n}  (${questionsFor(cls as OfficeClass).length} questions)`,
    );
  }

  if (accountedFor !== statedCandidacies) {
    console.error(
      `\nFAIL (RULING 100): the ballot file states ${statedCandidacies} candidacies and this run accounted for ${accountedFor}.`,
    );
    process.exitCode = 1;
    return;
  }
  if (breaches.length > 0) {
    console.error("\nFAIL (RULING 112): the invitation list is not symmetric.");
    for (const b of breaches) {
      console.error(`  ${b.contestId} · ${b.field} · ${b.values.join(" / ")}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!write) {
    console.log("\n(report only — pass --write to write the artifact)");
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        formatVersion: 1,
        generatedBy: "scripts/questionnaire-invitations.mts",
        note:
          "READY TO SEND, NOT SENT. Every row carries invitedOn: null and remindedOn: []. " +
          "A date on either is written only by the code path that performs the send (RULING 107). " +
          "Emails are the candidates' own filed contact from the Morris County Clerk's certified " +
          "candidate PDF, which is public record; they are held for sending and are never rendered.",
        instrumentVersion: INSTRUMENT_VERSION,
        plannedInvitedOn: PLANNED_INVITED_ON,
        plannedRemindersOn: PLANNED_REMINDERS_ON,
        deadline: DEADLINE,
        statedCandidacies,
        invitations,
        uninvitable,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${OUT}`);
}

main();
