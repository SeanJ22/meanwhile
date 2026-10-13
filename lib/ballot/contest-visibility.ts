/** Apply an established contest set, or restore every contest when no set is established. */
export function applyBallotContestScope(sections: Iterable<Pick<HTMLElement, "dataset">>, contestIds: readonly string[] | null): number {
  let hidden = 0;
  for (const section of sections) {
    const out = contestIds !== null && !contestIds.includes(section.dataset.contestId ?? "");
    if (out) {
      section.dataset.scopedOut = "true";
      hidden += 1;
    } else {
      delete section.dataset.scopedOut;
    }
    if (contestIds === null) {
      if (section.dataset.couldGovernParked === "true") {
        section.dataset.couldGovern = "true";
        delete section.dataset.couldGovernParked;
      }
    } else if (!out && section.dataset.couldGovern === "true") {
      delete section.dataset.couldGovern;
      section.dataset.couldGovernParked = "true";
    }
  }
  return hidden;
}
