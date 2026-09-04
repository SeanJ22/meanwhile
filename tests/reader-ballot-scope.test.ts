import assert from "node:assert/strict";
import test from "node:test";
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import { getGeneralLineup } from "../lib/ballot/general-lineup.ts";
import { readerContestScope } from "../lib/ballot/reader-scope.ts";
import { sharedNotesFor } from "../lib/ballot/shared-notes.ts";
import { ballotRecordsFor } from "../lib/ask/ballot-inventory.ts";

test("current certified scope retires obsolete filing notes in Ask and the shared ballot footer, retaining their dated source", async () => {
  const lineup = getGeneralLineup()!;
  let certifiedCount = 0;
  let wordingGaps = 0;
  let heldQuestions = 0;
  for (const { source } of BALLOT_SOURCES) {
    const set = source.normalize(await source.fetch());
    const currentNotes = [];
    for (const contest of set.contests) {
      const nominees = lineup.contests.find((entry) => entry.contestId === contest.id)?.nominees ?? [];
      const scope = readerContestScope(contest, { certified: nominees.length ? { count: nominees.length, sourceUrl: lineup.canvass.url, sourceOrg: lineup.canvass.issuedBy, readAt: lineup.canvass.readAt } : null, questionTextHeld: set.measures.some((measure) => measure.contestId === contest.id && Boolean(measure.questionText.trim())) });
      currentNotes.push({ id: contest.id, scopeNote: scope.currentNote });
      const answer = ballotRecordsFor({ kind: "CONTEST", id: contest.id, name: contest.title, contestId: contest.id, contestTitle: contest.title, ocdId: contest.ocdId }, { set, contests: set.contests, absences: set.absences, nominees: () => nominees.map((nominee) => ({ ...nominee, sourceUrl: lineup.canvass.url, sourceOrg: lineup.canvass.issuedBy, retrievedAt: lineup.canvass.readAt })) });
      const base = answer.records.find((record) => record.kind === "CONTEST" && record.id === contest.id)!;
      assert.equal(base.sourceUrl, contest.provenance.sourceUrl);
      assert.match(base.text, new RegExp(`Voters choose ${contest.voteFor}`));
      if (scope.mode === "CERTIFIED_NOMINEES") {
        certifiedCount++;
        assert.equal(scope.currentNote, null);
        assert.equal(scope.sourceScope?.text, contest.scopeNote);
        assert.equal(scope.sourceScope?.readAt, contest.provenance.collectedAt);
        assert.doesNotMatch(base.text, /not yet published|when it publishes|everyone who filed|only the Democratic candidates/i);
        const qualification = answer.records.find((record) => record.id === `${contest.id}#current-lineup`)!;
        assert.equal(qualification.text, scope.qualification!.text);
        assert.equal(qualification.sourceUrl, lineup.canvass.url);
        assert.equal(qualification.sourceOrg, lineup.canvass.issuedBy);
        assert.equal(qualification.retrievedAt, lineup.canvass.readAt);
        assert.equal(answer.records.filter((record) => record.kind === "CANDIDACY" && record.id.startsWith(`${contest.id}|`)).length, nominees.length);
      } else if (scope.mode === "HELD_WORDING_GAP") {
        wordingGaps++;
        assert.match(base.text, /We have not recorded the final ballot wording/);
        assert.doesNotMatch(base.text, /has not yet published/);
      } else {
        assert.equal(scope.currentNote, contest.scopeNote);
        if (contest.type === "MEASURE") heldQuestions++;
      }
    }
    const shared = sharedNotesFor(currentNotes);
    assert.ok(shared.notes.every((note) => !/has not yet published|when it publishes/.test(note.text)));
    for (const contest of lineup.contests) assert.equal(shared.isShared(contest.contestId), false);
  }
  assert.equal(certifiedCount, 12);
  assert.equal(wordingGaps, 11);
  assert.equal(heldQuestions, 4);
});
