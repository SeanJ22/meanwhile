import { BALLOT_SOURCES } from "../../lib/ballot/registry.ts";
import { lineupForContest } from "../../lib/ballot/general-lineup.ts";
import { surnameDisplayCase } from "../../lib/ballot/name-case.ts";
import { contestIncumbency, sameSeatDiscriminators } from "../../lib/ballot/incumbency-resolve.ts";
import { incumbentHolderFor } from "../../lib/ballot/incumbent-record.ts";
import { readerPersonKeys } from "../../lib/identity/reader-person.ts";
import { currentOfficialIdentity } from "../../lib/funding/campaign-money.ts";
import { officeIdentity } from "../../lib/officials/office-identity.ts";

/** Independent source-key denominator beside the real shared ballot selector. */
export async function readerIncumbencyProof() {
  const rows = [];
  let currentCandidates = 0;
  let currentContests = 0;
  const recovered = [];
  for (const { source } of BALLOT_SOURCES) {
    const set = source.normalize(await source.fetch());
    for (const contest of set.contests) {
      currentContests++;
      const lineup = lineupForContest(contest.id);
      const candidates = lineup ? lineup.nominees.map(nominee => ({ key: `${contest.id}|${nominee.name}`, targetKey: `${contest.id}|${nominee.name}`, display: nominee.name }))
        : set.candidacies.filter(candidate => candidate.contestId === contest.id).map(candidate => ({ key: candidate.id, targetKey: candidate.id, display: `${candidate.givenName} ${surnameDisplayCase(candidate.familyName)}` }));
      currentCandidates += candidates.length;
      const actual = await contestIncumbency({ ...contest, candidates, federal: /:us-senate$|:us-house-\d+$/.test(contest.id) }, incumbentHolderFor);
      const before = await contestIncumbency({ ...contest, candidates, federal: /:us-senate$|:us-house-\d+$/.test(contest.id) }, incumbentHolderFor, undefined, { committedHolder: async () => null });
      for (const candidate of candidates) {
        if (actual.decisions.get(candidate.key)?.standing === "INCUMBENT" && before.decisions.get(candidate.key)?.standing !== "INCUMBENT") recovered.push({ target: candidate.targetKey, contestId: contest.id, before: before.decisions.get(candidate.key), after: actual.decisions.get(candidate.key), officialId: actual.holderFor.get(candidate.key)?.id });
        const keys = readerPersonKeys(candidate.targetKey).keys;
        for (const key of keys) {
          const holder = currentOfficialIdentity(key);
          if (!holder) continue;
          const officeMatch = officeIdentity(contest.title) !== null && officeIdentity(contest.title) === officeIdentity(holder.officeTitle);
          const divisionMatch = holder.divisions.includes(contest.ocdId);
          const seatDiscriminatorMatch = sameSeatDiscriminators(contest.title, holder.officeTitle, contest.ocdId);
          const expectedIncumbent = officeMatch && divisionMatch && seatDiscriminatorMatch;
          rows.push({ officialId: holder.id, target: candidate.targetKey, candidacyId: keys.find(key => key.startsWith("ballot-") && !key.includes("|")) ?? null,
            contestId: contest.id, officeTitle: holder.officeTitle, contestTitle: contest.title, contestDivision: contest.ocdId, holderDivisions: holder.divisions,
            officeMatch, divisionMatch, seatDiscriminatorMatch, expectedIncumbent,
            actualHolderId: actual.holderFor.get(candidate.key)?.id ?? null, standing: actual.decisions.get(candidate.key)?.standing,
            status: expectedIncumbent ? actual.holderFor.get(candidate.key)?.id === holder.id && actual.decisions.get(candidate.key)?.standing === "INCUMBENT" ? "PROVEN" : "ELIGIBLE_NOT_DELIVERED" : actual.decisions.get(candidate.key)?.standing === "INCUMBENT" && actual.holderFor.get(candidate.key)?.id === holder.id ? "WRONG_OFFICE_ATTACHMENT" : "PERSON_ONLY_NOT_INCUMBENCY" });
        }
      }
    }
  }
  return { currentContests, currentCandidates, recovered, recoveredHolders: [...new Set(recovered.map(row => row.officialId))].length, committedRelations: rows.length, sameOfficeDivision: rows.filter(row => row.expectedIncumbent).length,
    personOnly: rows.filter(row => !row.expectedIncumbent).length, failed: rows.filter(row => row.status === "ELIGIBLE_NOT_DELIVERED" || row.status === "WRONG_OFFICE_ATTACHMENT").length, rows };
}
