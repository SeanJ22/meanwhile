/**
 * **THE CERTIFIED-LINEUP → CANDIDACY RECONCILIATION, OVER ITS WHOLE POPULATION.**
 * (Session C3, 2026-09-01. RULING 229.)
 *
 * The defect these tests exist for was measured on rendered DOM before a line
 * of this was written: at 9703dc9d, 85701 rendered 4 money states across 22
 * non-federal cards and 85641 rendered 4 across 25, because the cards asked the
 * state campaign-money snapshot by NOMINEE NAME and the snapshot is keyed on
 * canonical CANDIDACY ids. Katie Hobbs' own card said we hold no filing for her
 * over a reconciled FILED $11,109,719.95.
 *
 * What is asserted here is the RULE and the POPULATION, never an example:
 *
 * - a mapping needs all four criteria, and each one is tested by its own
 *   counter-example from the real Arizona 2026 data;
 * - the committed artifact's proof numbers add up to its own denominator;
 * - no two nominees resolve to one candidacy;
 * - the name parse is a PARSE — every form it emits is traceable to an
 *   annotation the publisher actually wrote, and no diminutive is ever invented.
 *
 * NO LIVE CALLS. Everything reads the committed artifacts.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  nameForms,
  nameFormKeys,
  quotedSegments,
  sharedNameForm,
} from "../lib/identity/name-forms.ts";
import { nameFormCollisions, normalizeParty, reconcileLineup } from "../lib/identity/reconcile.ts";
import type { AzIdentityRegistry, LineupReconciliation } from "../lib/identity/types.ts";

const ROOT = process.cwd();

const registry = JSON.parse(
  readFileSync(join(ROOT, "data", "identity", "az-2026-candidate-registry.json"), "utf8"),
) as AzIdentityRegistry;
const bridge = JSON.parse(
  readFileSync(
    join(ROOT, "data", "identity", "az-2026-certified-lineup-reconciliation.json"),
    "utf8",
  ),
) as LineupReconciliation;
const lineup = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "az-general-lineup-2026.json"), "utf8"),
) as { contests: { contestId: string; nominees: { name: string; partyLabel: string | null }[] }[] };

/* ── The registry is STATEWIDE, and that is a structural claim ───────────── */

test("the identity registry is keyed statewide, never by a county or a ZIP", () => {
  for (const contest of registry.contests) {
    assert.ok(
      contest.identityId.startsWith("az-2026:"),
      `contest identity ${contest.identityId} is not a statewide key`,
    );
    assert.ok(!/pima|85701|85641/i.test(contest.identityId), contest.identityId);
  }
  for (const cand of registry.candidates) {
    assert.ok(!/pima|85701|85641/i.test(cand.identityId), cand.identityId);
  }
});

test("the registry states every denominator it claims, and they equal the rows", () => {
  const d = registry.denominators;
  assert.equal(d.contests, registry.contests.length);
  assert.equal(d.candidates, registry.candidates.length);
  assert.equal(
    d.candidatesWithCanonicalCandidacyId + d.candidatesWithoutCanonicalCandidacyId,
    d.candidates,
  );
  assert.equal(d.nonFederalCandidates + d.federalCandidates, d.candidates);
  assert.equal(
    d.candidatesWithCanonicalCandidacyId,
    registry.candidates.filter((c) => c.canonicalCandidacyId !== null).length,
  );
});

test("a candidate no held ballot names gets NO invented candidacy id", () => {
  /*
   * **THIS TEST USED TO ASSERT `null` IMPLIED `canvass`, AND THAT WAS TRUE ONLY
   * WHILE THE POPULATION WAS ONE COUNTY'S BALLOT.**
   *
   * `canonicalCandidacyId` is the `ballot-az-pima:*` key the campaign-money
   * corpus is written against, so it can only be non-null for someone a held
   * certified ballot names. When the registry's population became the Secretary
   * of State's statewide filing list, 211 real filed candidates arrived with no
   * such key — and the old assertion read that as 213 write-in nominees.
   *
   * The invariant it was protecting is unchanged and is asserted harder below:
   * **no candidacy key is ever invented.** Every non-null one must appear in
   * the held ballot document itself, which is the check that would actually
   * catch a fabricated key — the old shape could not have.
   */
  const held = JSON.parse(
    readFileSync(join(ROOT, "data", "ballot", "az-pima-2026.json"), "utf8"),
  ) as { candidacies: { id: string }[] };
  const heldIds = new Set(held.candidacies.map((c) => c.id));
  assert.ok(heldIds.size > 0, "the held ballot produced no candidacy ids — a failed read");

  const withKey = registry.candidates.filter((c) => c.canonicalCandidacyId !== null);
  assert.ok(withKey.length > 0, "no registry candidate carries a candidacy key at all");
  for (const c of withKey) {
    assert.ok(
      heldIds.has(c.canonicalCandidacyId!),
      `${c.identityId} carries candidacy key ${c.canonicalCandidacyId}, which no held ballot ` +
        "publishes. A key no authority published is a fabrication the projection layer joins on.",
    );
  }

  /* Every candidate WITHOUT a key names an authority this project actually
     read. Two are the certified canvass's write-in winners; the rest are the
     Secretary's filed candidates who are on no ballot this project holds. Both
     are real people and neither may be rendered as the other. */
  const withoutKey = registry.candidates.filter((c) => c.canonicalCandidacyId === null);
  assert.ok(withoutKey.length > 0, "the registry holds nobody without a candidacy key");
  const authorities = new Set(withoutKey.map((c) => c.candidacyAuthority));
  for (const a of authorities) {
    assert.match(
      a,
      /Arizona Secretary of State/,
      `a candidate with no candidacy key cites "${a}", which is not an authority this registry reads`,
    );
  }
  assert.ok(
    withoutKey.some((c) => /canvass/i.test(c.candidacyAuthority)),
    "the registry holds no canvass-only candidate — the write-in nominees were dropped",
  );
});

/* ── The population proof ────────────────────────────────────────────────── */

test("the proof's buckets partition the whole lineup population", () => {
  const nominees = lineup.contests.flatMap((c) => c.nominees);
  const p = bridge.proof;
  assert.equal(p.lineupNominees, nominees.length, "the proof counts a different lineup");
  assert.equal(p.lineupNominees, bridge.rows.length, "a nominee has no row");
  assert.equal(
    p.uniquelyReconciled + p.ambiguous + p.unmatched,
    p.lineupNominees,
    "the three outcomes do not add up to the population",
  );
  assert.equal(
    p.applicableNonFederalReconciled + p.applicableNonFederalUnresolved,
    p.applicableNonFederalNominees,
  );
  assert.ok(p.applicableNonFederalNominees > 0);
});

test("no two nominees resolve to one candidacy — a collision is an error, not a tie", () => {
  const seen = new Map<string, string[]>();
  for (const row of bridge.rows) {
    if (!row.canonicalCandidacyId) continue;
    const list = seen.get(row.canonicalCandidacyId) ?? [];
    list.push(row.cardKey);
    seen.set(row.canonicalCandidacyId, list);
  }
  const collisions = [...seen.entries()].filter(([, keys]) => keys.length > 1);
  assert.deepEqual(collisions, [], "two nominees share a candidacy target");
  assert.equal(bridge.proof.duplicateTargetCollisions, 0);
});

test("every RECONCILED row carries a candidacy id, and every other row carries none", () => {
  for (const row of bridge.rows) {
    if (row.outcome === "RECONCILED") {
      assert.ok(row.canonicalCandidacyId, `${row.cardKey} is reconciled with no target`);
      assert.ok(row.candidateIdentityId, `${row.cardKey} is reconciled with no identity`);
      assert.equal(row.readerGapSentence, null);
    } else {
      assert.equal(row.canonicalCandidacyId, null, `${row.cardKey} unresolved with a target`);
      assert.ok(
        row.readerGapSentence && row.readerGapSentence.length > 0,
        `${row.cardKey} is unresolved and names no gap`,
      );
    }
  }
});

test("every row records both authorities' published values and its basis", () => {
  for (const row of bridge.rows) {
    assert.equal(row.sourceValues.canvassName, row.nomineeName);
    assert.ok(typeof row.basis.note === "string" && row.basis.note.length > 0);
    if (row.outcome === "RECONCILED") {
      assert.ok(row.basis.sharedNameForm, `${row.cardKey} reconciled with no shared form`);
      assert.ok(row.basis.sharedNameFormRules.length > 0);
      assert.ok(row.sourceValues.registryName, `${row.cardKey} names no registry name`);
    }
  }
});

/* ── The four criteria, each with a real counter-example ─────────────────── */

test("CRITERION 1 — a name is never compared across contests", () => {
  /* Alma Hernandez is a state-senate-20 candidacy. Asking for her under a
     different contest resolves to nothing rather than to her. */
  const rows = reconcileLineup({
    nominees: [
      { contestId: "ballot-az-pima:governor", name: "Alma Hernandez", partyLabel: "Democratic" },
    ],
    candidates: registry.candidates.filter((c) => c.canonicalCandidacyId !== null),
    candidateContestIds: new Map(registry.contests.map((c) => [c.identityId, c.canonicalContestIds])),
    isFederalContestId: () => false,
    agencyName: "Arizona Secretary of State — See The Money",
  });
  assert.equal(rows.rows[0].outcome, "NO_CANDIDATE_MATCH");
  assert.equal(rows.rows[0].canonicalCandidacyId, null);
});

test("CRITERION 2 — a party disagreement between the two authorities blocks the mapping", () => {
  /* The real one: the canvass says No Labels for Teri Ann Hourihan and the
     filing list says Arizona Independent Party. One name match, and it is
     refused. */
  const row = bridge.rows.find((r) => r.nomineeName === "Teri Ann Hourihan");
  assert.ok(row, "the Hourihan control is missing from the artifact");
  assert.equal(row!.outcome, "PARTY_CONFLICT");
  assert.equal(row!.canonicalCandidacyId, null);
  assert.equal(row!.basis.partyChecked, true);
  assert.equal(row!.basis.partyAgrees, false);
  assert.equal(row!.sourceValues.canvassParty, "No Labels");
  assert.equal(row!.sourceValues.registryParty, "Arizona Independent Party");
});

test("CRITERION 2 — the party test does not apply where an authority is silent", () => {
  const out = reconcileLineup({
    nominees: [{ contestId: "c", name: "Ada Lovelace", partyLabel: null }],
    candidates: [
      {
        identityId: "id-1",
        contestIdentityId: "ci",
        displayName: "Ada Lovelace",
        givenName: "Ada",
        familyName: "Lovelace",
        nameForms: nameForms("Ada Lovelace"),
        partyLabel: "Democratic",
        candidacyAuthority: "t",
        candidacySourceUrl: null,
        canonicalCandidacyId: "cand-1",
        committees: [],
      },
    ],
    candidateContestIds: new Map([["ci", ["c"]]]),
    isFederalContestId: () => false,
    agencyName: "agency",
  });
  assert.equal(out.rows[0].outcome, "RECONCILED");
  assert.equal(out.rows[0].basis.partyChecked, false);
  assert.equal(out.rows[0].basis.partyAgrees, null);
});

test("CRITERION 3 — two candidates sharing a name form is AMBIGUOUS, never a tie-break", () => {
  const twins = ["a", "b"].map((suffix) => ({
    identityId: `id-${suffix}`,
    contestIdentityId: "ci",
    displayName: "Chris Green",
    givenName: "Chris",
    familyName: "Green",
    nameForms: nameForms("Chris Green"),
    partyLabel: "Democratic",
    candidacyAuthority: "t",
    candidacySourceUrl: null,
    canonicalCandidacyId: `cand-${suffix}`,
    committees: [],
  }));
  const out = reconcileLineup({
    nominees: [{ contestId: "c", name: "Chris Green", partyLabel: "Democratic" }],
    candidates: twins,
    candidateContestIds: new Map([["ci", ["c"]]]),
    isFederalContestId: () => false,
    agencyName: "agency",
  });
  assert.equal(out.rows[0].outcome, "AMBIGUOUS_MULTIPLE_CANDIDATES");
  assert.equal(out.rows[0].canonicalCandidacyId, null);
  assert.equal(out.rows[0].sourceValues.registryCandidateIds.length, 2);
});

test("CRITERION 3 — a nominee the filing list never carried stays unmatched", () => {
  /* Bob Karp and Gary Swing won their primaries as write-ins and never appear
     on the March candidate-filing list. Neither is matched to the nearest
     person in their contest, because there is no such thing here. */
  for (const name of ["Bob Karp", "Gary Swing"]) {
    const row = bridge.rows.find((r) => r.nomineeName === name);
    assert.ok(row, `${name} has no row`);
    assert.equal(row!.outcome, "NO_CANDIDATE_MATCH");
    assert.equal(row!.canonicalCandidacyId, null);
  }
});

test("no diminutive is ever inferred — Tom is not derived from Thomas", () => {
  assert.equal(sharedNameForm("Tom Horne", "Thomas Chalres Horne"), null);
  assert.equal(sharedNameForm("Bob Karp", "Robert Karp"), null);
  assert.equal(sharedNameForm("Katie Hobbs", "Katherine Hobbs"), null);
});

/* ── The name parse ──────────────────────────────────────────────────────── */

test("a quoted annotation is read as BOTH a given and a family stand-in", () => {
  /* Arizona 2026 contains one of each and marks them identically. */
  assert.ok(nameFormKeys('Nicholas "Nick" Myers').has("nick myers"));
  assert.ok(nameFormKeys('Rachel "Jones" Keshel').has("rachel jones"));
  assert.ok(nameFormKeys('Walter "Les" Presmyk').has("les presmyk"));
  assert.ok(nameFormKeys('Walter "Les" Presmyk').has("walter presmyk"));
});

test("the nickname control reconciles on the real lineup row", () => {
  const row = bridge.rows.find((r) => r.nomineeName === 'Walter "Les" Presmyk');
  assert.ok(row, "the Presmyk nickname control is missing");
  assert.equal(row!.outcome, "RECONCILED");
  assert.equal(row!.canonicalCandidacyId, "ballot-az-pima:mine-inspector:presmyk-walter");
});

test("Katie Hobbs reconciles to the candidacy the money snapshot is keyed on", () => {
  const row = bridge.rows.find((r) => r.nomineeName === "Katie Hobbs");
  assert.ok(row, "the Hobbs control is missing");
  assert.equal(row!.outcome, "RECONCILED");
  assert.equal(row!.canonicalCandidacyId, "ballot-az-pima:governor:hobbs-katie");
});

test("a generational suffix is an annotation, and it is stripped symmetrically", () => {
  assert.ok(sharedNameForm("Daniel Francis Butierez Sr.", "Daniel Francis Butierez") !== null);
  assert.ok(sharedNameForm("Daniel Francis Butierez Sr.", "Daniel Francis Butierez Sr") !== null);
  /* And it never eats a real name token. */
  assert.equal(sharedNameForm("Vi Nguyen", "Nguyen"), null);
});

test("curly punctuation and a period are folded; an apostrophe is not dropped", () => {
  assert.ok(sharedNameForm("Jackie O’Donnell Anderson", "Jackie O'Donnell Anderson") !== null);
  assert.ok(sharedNameForm("Michael D. Butts", "Michael D Butts") !== null);
  assert.equal(sharedNameForm("Jackie ODonnell Anderson", "Jackie O'Donnell Anderson"), null);
});

test("quotedSegments reads the annotation the publisher actually wrote", () => {
  assert.deepEqual(quotedSegments('Walter "Les" Presmyk'), ["Les"]);
  assert.deepEqual(quotedSegments("Katie Hobbs"), []);
  assert.deepEqual(quotedSegments("Hollace “Holly” Lyon"), ["Holly"]);
});

test("normalizeParty folds only what is symmetric, and never merges two parties", () => {
  assert.equal(normalizeParty("Green"), normalizeParty("Green Party"));
  assert.equal(normalizeParty("  democratic "), "democratic");
  assert.notEqual(normalizeParty("No Labels"), normalizeParty("Arizona Independent Party"));
  assert.equal(normalizeParty(null), null);
});

test("no within-contest name-form collision exists in the committed registry", () => {
  /* Not a rule — two people really can share a name — but a change that
     silently stopped producing collisions would be a change that started
     guessing, so the current answer is pinned with its denominator. */
  const collisions = nameFormCollisions(registry.candidates);
  assert.deepEqual(
    collisions,
    [],
    `collisions found across ${registry.candidates.length} registry candidates`,
  );
});
