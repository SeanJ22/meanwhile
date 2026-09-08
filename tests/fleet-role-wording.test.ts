/**
 * **ONE NAME AND ONE SENTENCE PER ROLE.** (ADM-43 and §9A.20, from the 9.6.26
 * owner review.)
 *
 * The seeded failures:
 *
 *   1  two codes in one heading — `Parsers PARSER · DETECTIVES`,
 *      `Auditors ADVERSARIAL_AUDITOR`. The owner: *"it should just simply say
 *      Detectives … and next to it in smaller font I want to say, 'What is
 *      that? What does that mean? What does a detective do?'"*
 *   2  two role dictionaries that can disagree. `ROLE_WORDS` used to say
 *      "Scout" and "Adversarial Auditor" while `plainCode` said "Hunter" and
 *      "Auditor", so the same worker had two names on two screens.
 *   3  a role sentence that describes the GROUP rather than the role's actual
 *      contract. Each sentence is checked against the canonical worker module.
 *   4  a second `codeWords` implementation beside `plainCode` (RULING 103).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { WORKER_ROLES } from "@/lib/control-plane/attempt.ts";
import { plainCode } from "@/lib/control-plane/plain-words.ts";
import { FLEET_ROLES } from "@/lib/control-plane/workers/types.ts";
import {
  ROLE_GROUP,
  ROLE_ONE_LINER,
  ROLE_WORDS,
  codeWords,
  roleGroupNote,
  roleOneLiner,
  roleTitle,
  roleWords,
} from "@/app/(admin)/fleet-wording.ts";

const ROOT = process.cwd();
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const MACHINE = /[A-Z][A-Z0-9]*_[A-Z0-9_]+/;

test("SEEDED: every worker role has exactly ONE owner-facing name, and it is the console's one dictionary", () => {
  for (const role of WORKER_ROLES) {
    assert.equal(ROLE_WORDS[role], plainCode(role), `${role} has a second name beside plainCode`);
    assert.doesNotMatch(ROLE_WORDS[role], MACHINE, `${role} still reads as a code`);
  }
  // The two the owner named by hand.
  assert.equal(ROLE_WORDS.SCOUT, "Hunter");
  assert.equal(ROLE_WORDS.ADVERSARIAL_AUDITOR, "Auditor", "\"Adversarial Auditor/Auditor. We don't need all that.\"");
  assert.equal(ROLE_WORDS.ENGINEERING, "Engineer");
  // The card heading is that one name, plural, and nothing else.
  assert.deepEqual(
    FLEET_ROLES.map(roleTitle),
    /*
     * ADM-63 (9.7.26): "Verifiers", not "Validators". This array pinned the
     * DEFECT — the heading said Validators from this dictionary while the
     * activity sentence beneath it said verifiers from a second one, on the
     * same card. The owner asked for one vocabulary and named it: Hunters,
     * Detectives, Verifiers, Auditors, Engineers. Superseded deliberately.
     */
    ["Parsers", "Verifiers", "Auditors", "Acquirers", "Detectives", "Engineers"],
  );
  assert.equal(roleTitle("SCOUT"), "Hunters");
  // A caller key keeps its parenthetical and gains the name.
  assert.equal(roleWords("SCOUT (control-plane model workers)"), "Hunter (control-plane model workers)");
  assert.equal(roleWords("not a role code"), "not a role code");
});

test("SEEDED: each role's sentence describes its own canonical contract, not its group's summary line", () => {
  for (const role of WORKER_ROLES) {
    const line = roleOneLiner(role);
    assert.ok(line.length > 40, `${role} has no sentence`);
    assert.doesNotMatch(line, MACHINE, `${role}'s sentence carries a machine constant`);
    assert.match(line, /\.$/, `${role}'s sentence is not a sentence`);
  }
  // The distinction the owner could not make from the old labels (§9A.20).
  assert.match(ROLE_ONE_LINER.SCOUT, /Goes looking for the official source/);
  assert.match(ROLE_ONE_LINER.DETECTIVE, /When the obvious route is missing, blocked, ambiguous or incomplete/);
  assert.match(ROLE_ONE_LINER.PARSER, /already been fetched\. It never goes to the internet itself\./);
  assert.match(ROLE_ONE_LINER.VALIDATOR, /matches the source and the rules/);
  assert.match(ROLE_ONE_LINER.ADVERSARIAL_AUDITOR, /disprove a checked fact using independent evidence/);
  assert.match(ROLE_ONE_LINER.ENGINEERING, /never merges anything itself/);
  // Each sentence is checked against the module that actually implements the role.
  for (const [role, file] of [
    ["PARSER", "lib/control-plane/workers/parser.ts"],
    ["DETECTIVE", "lib/control-plane/workers/detective.ts"],
    ["VALIDATOR", "lib/control-plane/workers/validator.ts"],
    ["ADVERSARIAL_AUDITOR", "lib/control-plane/workers/auditor.ts"],
    ["ACQUIRER", "lib/control-plane/workers/acquirer.ts"],
    ["ENGINEERING", "lib/control-plane/workers/engineering.ts"],
  ] as const) {
    assert.ok(existsSync(join(ROOT, file)), `${role}'s canonical module is missing, so its sentence is unverifiable`);
  }
  // The Parser really does not fetch, and the Detective really does test alternatives: the two claims the copy makes.
  assert.match(src("lib/control-plane/workers/detective.ts"), /alternatives\.length < 2/, "the Detective is required to test at least two explanations");
  assert.match(src("lib/control-plane/workers/parser.ts"), /ParserWorkerInput/, "the Parser takes evidence in, never a URL");
  assert.match(src("lib/control-plane/workers/engineering.ts"), /No write, fetch, shell, deployment, promotion, or integration callback is exposed/);
});

test("SEEDED: the fleet grouping is said in a sentence, not printed as a second code beside the first", () => {
  // Parser and Detective ARE one group in fleet-view.ts and two roles in workers/types.ts, so the card says both facts.
  assert.equal(
    roleGroupNote("PARSER"),
    "On the fleet view, Parsers and Detectives are counted together in one group called Detectives. They are still separate roles with different jobs.",
  );
  assert.equal(
    roleGroupNote("ACQUIRER"),
    "On the fleet view, Acquirers and Hunters are counted together in one group called Hunters. They are still separate roles with different jobs.",
  );
  // ADM-63: with one vocabulary the role and its group share a name, so the
  // sentence that used to reconcile two names has nothing left to reconcile.
  assert.equal(roleGroupNote("VALIDATOR"), "On the fleet view, Verifiers are their own group.");
  assert.equal(roleGroupNote("ADVERSARIAL_AUDITOR"), "On the fleet view, Auditors are their own group.");
  assert.equal(roleGroupNote("RELEASE_ORCHESTRATOR"), "", "a role in no group says nothing rather than inventing one");
  // Every role's note is free of codes.
  for (const role of WORKER_ROLES) assert.doesNotMatch(roleGroupNote(role), MACHINE, `${role}'s group note carries a code`);
  // Membership still mirrors fleet-view, which owns it.
  assert.equal(ROLE_GROUP.PARSER, "detectives");
  assert.equal(ROLE_GROUP.DETECTIVE, "detectives");
  assert.equal(ROLE_GROUP.SCOUT, "hunters");
});

test("SEEDED: codeWords is plainCode itself, not a second implementation of the same rule (RULING 103)", () => {
  assert.equal(codeWords, plainCode);
  assert.equal(codeWords("SCHEDULED_BLACKOUT"), "Scheduled quiet period", "the owner's wording, not the mechanical de-underscoring");
  assert.match(src("app/(admin)/fleet-wording.ts"), /export \{ plainCode as codeWords \}/);
  assert.doesNotMatch(src("app/(admin)/fleet-wording.ts"), /export function codeWords/);
});

test("ADM-43: the role card prints one name, one sentence, Needs you at the top, and no code in its heading", () => {
  const panel = src("app/(admin)/admin/research/worker-fleet-panel.tsx");
  /*
   * ADM-63 (9.7.26): the role heading dropped a level. The five FLEET GROUPS —
   * the owner's five names — are the h3 sections now, and a role is an h4
   * inside its group. That is what "sub-roles appear as a small label line
   * under the group name, not as their own sections" means in markup. The
   * assertion is unchanged in substance: one name in the heading, code on hover.
   */
  assert.match(panel, /<h4 id=\{`role-\$\{role\.role\}`\} title=\{role\.role\}>\{title\}<\/h4>/, "one name in the heading, the code on hover");
  assert.match(panel, /FLEET_GROUPS\.map\(\(group\)/, "the five groups are the sections");
  assert.doesNotMatch(panel, /className="fleet-roles"/, "the uppercase code sublabel is gone");
  assert.doesNotMatch(panel, /FLEET_GROUP_WORDING/, "the group name is no longer printed beside the role name");
  assert.match(panel, /\{roleOneLiner\(role\.role\)\}/, "the sentence beside the name");
  /*
   * ADM-63: `roleGroupNote` is gone from the panel, and its absence is the
   * point rather than a regression. It existed to say "on the fleet view this
   * role is counted under a different name" — a sentence apologising for two
   * vocabularies. The group is the section heading above the role now, so
   * there is no second name to reconcile. The grouping is still in words; it
   * is just in the heading and its sub-line instead of a footnote.
   */
  assert.doesNotMatch(panel, /roleGroupNote/, "the note reconciling two vocabularies is gone with the second vocabulary");
  assert.match(panel, /fleet-group-roles/, "the group says what it is and which roles it counts");
  // Needs you comes before what it is doing (POS-14: "I like that being at the top").
  const needsAt = panel.indexOf("<NeedsYouLine");
  const doingAt = panel.indexOf('className="role-doing"');
  assert.ok(needsAt > 0 && doingAt > needsAt, "Needs you sits above the activity line");
  // ADM-44: what happened / what happens next / does this need me, and $0 where it means $0.
  assert.match(panel, /<th scope="col">What happened<\/th><th scope="col">What happens next<\/th><th scope="col">Needs you<\/th>/);
  assert.match(panel, /workerAttemptStory\(/);
  assert.match(panel, /\{usdCents\(0\)\} this run/, "a deterministic attempt shows $0, not 'not measured'");
  assert.doesNotMatch(panel, /\$0 by design/, "the console no longer claims a role is inherently free (§9A.4)");
  // ADM-48: a name on the face, the exact id one disclosure and one copy away, and only one copy button in the repo.
  assert.match(panel, /<Identity id=\{attempt\.attemptId\}/);
  assert.match(src("app/(admin)/admin/research/identity.tsx"), /import \{ CopyButton \} from "\.\.\/release-review\/copy-button"/);
  assert.equal(existsSync(join(ROOT, "app", "(admin)", "admin", "release-review", "copy-button.tsx")), true);
});
