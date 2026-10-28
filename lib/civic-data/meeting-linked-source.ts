import { createHash } from "node:crypto";
import { decodeHTML } from "entities";
import type { DerivedInputRef } from "./derived-authority.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";

type MemberInput = Extract<DerivedInputRef, { kind: "MEMBER_ACQUISITION" }>;
const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
const key = (page: Pick<MemberInput, "requestedUrl" | "finalUrl" | "rawHash">) => `${page.requestedUrl}\n${page.finalUrl}\n${page.rawHash}`;
const onHost = (page: Pick<MemberInput, "requestedUrl" | "finalUrl">, host: string) => {
  try { return [page.requestedUrl, page.finalUrl].every(url => { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password && bare(parsed.hostname) === bare(host); }); }
  catch { return false; }
};

/** HTML, JSON and folded iCalendar links all retain the exact URL published in their source bytes. */
export function meetingPageLinksTo(bytes: Uint8Array, base: string, target: string): boolean {
  const text = decodeHTML(new TextDecoder().decode(bytes).replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/\r?\n[ \t]/g, ""));
  const links = [...text.matchAll(/https:\/\/[^\s"'<>\\]+/g)].map(match => match[0]);
  for (const match of text.matchAll(/["']([^"'<>\r\n]+)["']/g)) links.push(match[1]);
  return links.some(link => {
    try { const resolved = new URL(link, base); resolved.hash = ""; const wanted = new URL(target); wanted.hash = ""; return resolved.href === wanted.href; }
    catch { return false; }
  });
}

/** A calendar member keeps its original host boundary. Only an actual published link extends its evidence. */
export function linkedMeetingSourceInputs(input: {
  readonly memberKey: string; readonly officialHost: string; readonly roots: readonly MemberInput[];
  readonly pages: readonly RetainedSourceResponse[]; readonly horizonDay: string;
}): { readonly inputs: readonly MemberInput[]; readonly unlinked: readonly string[] } {
  const authorized = new Map(input.roots.map(page => [key(page), page]));
  const pages = new Map(input.pages.map(page => [key(page), page]));
  const pending = [...input.pages].filter(page => !authorized.has(key(page)));
  const inputs: MemberInput[] = [];
  for (let changed = true; changed && pending.length;) {
    changed = false;
    for (let index = pending.length - 1; index >= 0; index--) {
      const page = pending[index]!;
      const parent = onHost(page, input.officialHost) ? undefined : [...authorized.values()].find(parent => {
        const acquired = pages.get(key(parent));
        return acquired && meetingPageLinksTo(acquired.bytes, acquired.finalUrl, page.requestedUrl);
      });
      if (!onHost(page, input.officialHost) && !parent) continue;
      const reference: MemberInput = { kind: "MEMBER_ACQUISITION", memberKey: input.memberKey, requestedUrl: page.requestedUrl, finalUrl: page.finalUrl,
        rawHash: page.rawHash, httpStatus: page.httpStatus, retrievedAt: page.retrievedAt, horizonDay: input.horizonDay,
        ...(parent ? { linkedFrom: { requestedUrl: parent.requestedUrl, finalUrl: parent.finalUrl, rawHash: parent.rawHash } } : {}) };
      authorized.set(key(reference), reference); inputs.push(reference); pending.splice(index, 1); changed = true;
    }
  }
  return { inputs, unlinked: pending.map(page => page.requestedUrl) };
}

/** Promotion verifies the same link chain and retained body hashes, rather than accepting another host by name. */
export function linkedMeetingSourceIssue(member: MemberInput, officialHost: string, members: readonly MemberInput[],
  retained: readonly (Omit<RetainedSourceResponse, "bytes"> & { readonly base64: string })[], visited = new Set<string>()): string | null {
  if (onHost(member, officialHost)) return null;
  if (!member.linkedFrom || visited.has(key(member))) return `DERIVED_MEMBER_HOST_NOT_ATTESTED: ${member.requestedUrl} is not on ${officialHost}`;
  visited.add(key(member));
  const parent = members.find(page => page.memberKey === member.memberKey && key(page) === key(member.linkedFrom!));
  if (!parent) return `DERIVED_MEMBER_LINK_PARENT_MISSING: ${member.requestedUrl}`;
  const parentIssue = linkedMeetingSourceIssue(parent, officialHost, members, retained, visited);
  if (parentIssue) return parentIssue;
  const parentBytes = retained.find(page => key(page) === key(parent));
  const childBytes = retained.find(page => key(page) === key(member));
  if (!parentBytes || !childBytes) return `DERIVED_MEMBER_LINK_BYTES_MISSING: ${member.requestedUrl}`;
  const decoded = Buffer.from(parentBytes.base64, "base64"), child = Buffer.from(childBytes.base64, "base64");
  if (createHash("sha256").update(decoded).digest("hex") !== parent.rawHash || createHash("sha256").update(child).digest("hex") !== member.rawHash) {
    return `DERIVED_MEMBER_LINK_BYTES_MISMATCH: ${member.requestedUrl}`;
  }
  return meetingPageLinksTo(decoded, parent.finalUrl, member.requestedUrl) ? null : `DERIVED_MEMBER_LINK_NOT_PUBLISHED: ${member.requestedUrl}`;
}
