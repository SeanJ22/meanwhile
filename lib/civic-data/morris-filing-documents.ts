export function isMorrisGeneralCandidatesDocument(url: string): boolean {
  return /(?:^|\/)2026-general(?:-election)?-candidates(?:-(?![^/]*school)[^/]*)?\.pdf(?:$|[?#])/i.test(url) &&
    !/general-school-candidates/i.test(url);
}

export function isMorrisSchoolCandidatesDocument(url: string): boolean {
  return /(?:^|\/)2026-general-school-candidates(?:-[^/]*)?\.pdf(?:$|[?#])/i.test(url);
}
