/**
 * Each publication pass reads the shared field manual before checking anything and writes back what it learned:
 * - OFFICIAL_LINK: a non-`.gov` host an official page links, with that saved page; later jobs reuse it.
 * - SOURCE_REGISTER: a saved official page that passed, and for what.
 * - SECTION3_REFUSAL: a refused page and the reason, so the next worker fetches what was missing.
 */
import {
  newFieldManualEntry,
  readFieldManual,
  writeFieldManual,
  type FieldManualEntry,
  type FieldManualRepos,
} from "../field-manual.ts";
import { rolePlaybook } from "../playbooks.ts";

const SOURCE = "section3-validator";

export interface ValidatorManual {
  /** host → saved official pages (artifact ids) that link it, newest first. */
  readonly officialLinks: ReadonlyMap<string, readonly string[]>;
  readonly offered: number;
  readonly playbook: string;
  readonly error?: string;
}

export const hostOfUrl = (url: string): string | null =>
  /^https?:\/\/([^/?#:\s]+)/i.exec(url.trim())?.[1]?.toLowerCase().replace(/^www\./, "") ?? null;

/** THE READ, once per pass, before any record is checked. A failed read checks without inherited links. */
export async function readValidatorManual(repos: FieldManualRepos): Promise<ValidatorManual> {
  const read = await readFieldManual(repos, { role: "VALIDATOR", kinds: ["OFFICIAL_LINK", "PLAYBOOK"], everywhere: true });
  const links = new Map<string, string[]>();
  // Every official link counts, whatever state or record class learned it.
  const entries = read.store.entries.filter(e => e.kind === "OFFICIAL_LINK").sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""));
  for (const entry of entries) {
    const payload = entry.payload as { host?: unknown; linkingArtifactId?: unknown } | null;
    if (entry.kind !== "OFFICIAL_LINK" || entry.outcome !== "YIELDED" || typeof payload?.host !== "string" || typeof payload.linkingArtifactId !== "string") continue;
    links.set(payload.host, [...(links.get(payload.host) ?? []), payload.linkingArtifactId]);
  }
  return { officialLinks: links, offered: read.projection.entryIds.length, playbook: rolePlaybook(read.store.entries, "VALIDATOR").text, ...(read.error ? { error: read.error } : {}) };
}

export interface ValidatorObservation {
  readonly recordClass: string;
  readonly state: string | null;
  readonly workItemId: string;
  readonly page: { readonly url: string; readonly artifactId: string; readonly contentHash: string } | null;
  /** The saved official page that made a non-`.gov` page official. */
  readonly linking: { readonly url: string; readonly artifactId: string } | null;
  readonly published: number;
  /** A refusal of the source itself, not a transient publisher hold. */
  readonly refusal: { readonly code: string; readonly detail: string } | null;
}

export function validatorLessons(o: ValidatorObservation, now: string): FieldManualEntry[] {
  if (!o.page) return [];
  const host = hostOfUrl(o.page.url);
  const common = { states: o.state ? [o.state.toLowerCase()] : [], recordClasses: [o.recordClass], observedAt: now, url: o.page.url };
  const lessons: FieldManualEntry[] = [];
  if (o.published > 0) {
    lessons.push(newFieldManualEntry(SOURCE, `pass|${o.recordClass}|${o.page.url}`, { ...common, role: "SHARED", kind: "SOURCE_REGISTER", outcome: "YIELDED",
      title: `${o.recordClass} verified from ${host ?? o.page.url}`,
      summary: `§3 passed: ${o.published} record(s) read from this saved official page${o.linking ? `, official because ${o.linking.url} links it` : ""}.`,
      payload: { workItemId: o.workItemId, artifactId: o.page.artifactId, contentHash: o.page.contentHash, linkingUrl: o.linking?.url ?? null } }));
    if (o.linking && host) lessons.push(newFieldManualEntry(SOURCE, `official-link|${host}`, { ...common, recordClasses: [], role: "SHARED", kind: "OFFICIAL_LINK", outcome: "YIELDED",
      title: `${host} counts as official`,
      summary: `${o.linking.url} (an official page) links ${host}, so its pages count as official sources under §3.`,
      payload: { host, linkingUrl: o.linking.url, linkingArtifactId: o.linking.artifactId } }));
  } else if (o.refusal) {
    lessons.push(newFieldManualEntry(SOURCE, `refused|${o.recordClass}|${o.page.url}|${o.refusal.code}`, { ...common, role: "VALIDATOR", kind: "SECTION3_REFUSAL", outcome: "FAILED",
      title: `${o.recordClass} refused from ${host ?? o.page.url}: ${o.refusal.code}`,
      summary: o.refusal.detail.slice(0, 240),
      payload: { workItemId: o.workItemId, artifactId: o.page.artifactId, code: o.refusal.code } }));
  }
  return lessons;
}

/** THE WRITE, once per pass. A failed write never undoes a publication. */
export async function writeValidatorLessons(repos: FieldManualRepos, observations: readonly ValidatorObservation[], now: string) {
  return writeFieldManual(repos, observations.flatMap(o => validatorLessons(o, now)), now);
}
