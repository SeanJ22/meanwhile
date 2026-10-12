import type { ManualSourceReview } from "./types.ts";

/** A member citation names a pinned document, while HTTP provenance continues to name the actual archive. */
export function extractedMemberUrl(source: ManualSourceReview, member: { readonly path: string; readonly sha256: string }): string | null {
  const revision = /^https:\/\/codeload\.github\.com\/openstates\/people\/zip\/([a-f0-9]{40})$/.exec(source.finalUrl)?.[1];
  if (!revision || !/^[a-f0-9]{64}$/.test(member.sha256) ||
    !/^data\/[a-z]{2}\/(?:legislature|executive|municipal|municipalities)\/.+\.ya?ml$/.test(member.path) ||
    member.path.split("/").some(part => part === "." || part === "..") || /[%\\?#\u0000-\u001f]/.test(member.path)) return null;
  return `https://raw.githubusercontent.com/openstates/people/${revision}/${member.path}`;
}

export function manualSourceUrls(source: ManualSourceReview): readonly string[] {
  return [...new Set([source.requestedUrl, source.finalUrl,
    ...(source.extractedMembers ?? []).map(member => extractedMemberUrl(source, member)).filter((url): url is string => url !== null)])];
}

/** Different state projections can cite separate members of the same held national archive. */
export function mergeManualSourceCopies(left: ManualSourceReview | undefined, right: ManualSourceReview): ManualSourceReview {
  if (!left?.extractedMembers?.length && !right.extractedMembers?.length) return right;
  const members = new Map([...(left?.extractedMembers ?? []), ...(right.extractedMembers ?? [])].map(member => [member.path, member]));
  return { ...right, extractedMembers: [...members.values()].sort((a,b) => a.path.localeCompare(b.path)) };
}
