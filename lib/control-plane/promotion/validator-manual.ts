/**
 * Publication reads the current source host's shared lessons and writes back what it learned:
 * - OFFICIAL_LINK: a non-`.gov` host an official page links, with that saved page; later jobs reuse it.
 * - SOURCE_REGISTER: a saved official page that passed, and for what.
 * - SECTION3_REFUSAL: a refused page and the reason, so the next worker fetches what was missing.
 */
import {
  newFieldManualEntry,
  writeFieldManual,
  type FieldManualEntry,
  type FieldManualRepos,
} from "../field-manual.ts";

const SOURCE = "section3-validator";

export interface ValidatorOfficialLinks {
  /** Saved official pages linking this host, newest first. Publication uses at most three. */
  readonly artifactIds: readonly string[];
  readonly offered: number;
  readonly error?: string;
}

export const hostOfUrl = (url: string): string | null =>
  /^https?:\/\/([^/?#:\s]+)/i.exec(url.trim())?.[1]?.toLowerCase().replace(/^www\./, "") ?? null;

/** Read only this host, across all sources and places. A failed read checks without inherited links. */
export async function readValidatorOfficialLinks(repos: FieldManualRepos, host: string): Promise<ValidatorOfficialLinks> {
  const selected: { id: string; artifactId: string; observedAt: string }[] = [];
  let offered = 0;
  try {
    await repos.fieldManual.visitSlice({ role: "VALIDATOR", kinds: ["OFFICIAL_LINK"], everywhere: true, payloadHost: host }, ({ value: entry }) => {
      const payload = entry.payload as { host?: unknown; linkingArtifactId?: unknown } | null;
      if (entry.kind !== "OFFICIAL_LINK" || !["SHARED", "VALIDATOR"].includes(entry.role) || payload?.host !== host) return;
      offered++;
      if (entry.outcome !== "YIELDED" || typeof payload.linkingArtifactId !== "string") return;
      selected.push({ id: entry.id, artifactId: payload.linkingArtifactId, observedAt: entry.observedAt ?? "" });
      selected.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id));
      if (selected.length > 3) selected.pop();
    }, { id: true, role: true, kind: true, outcome: true, observedAt: true, payload: ["host", "linkingArtifactId"] });
    return { artifactIds: selected.map(entry => entry.artifactId), offered };
  } catch (error) {
    return { artifactIds: [], offered: 0, error: error instanceof Error ? error.message : String(error) };
  }
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
