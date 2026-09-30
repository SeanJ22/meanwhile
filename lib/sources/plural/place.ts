import { bulkUrl, indexDivisions, normalize, pluralRosterIssue, rowsToPeople } from "./index.ts";
import { cellText, decodeEntities, extractRoster } from "../../hunt/roster-page.ts";
import type { PlaceDivision } from "../../control-plane/expansion/national-geography.ts";

export interface HeldSourcePage {
  readonly url: string;
  readonly text: string;
  readonly collectedAt: string;
}
export interface NationalOfficialCandidate {
  readonly discoveryId: string;
  readonly divisionId: string;
  readonly name: string;
  readonly officeTitle: string;
  readonly officialUrl: string;
  readonly document: HeldSourcePage;
  /** Exact source words, never a claim that the publisher has verified them. */
  readonly quote: string;
}
export interface NationalPlaceSources {
  readonly officials: readonly NationalOfficialCandidate[];
  readonly electionDocuments: readonly HeldSourcePage[];
  readonly documents: readonly HeldSourcePage[];
  readonly gaps: readonly { sourceUrl: string; detail: string }[];
}

function links(page: HeldSourcePage): { url: string; label: string }[] {
  return [...page.text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match => {
    try {
      const url = new URL(decodeEntities(match[1]), page.url);
      return url.protocol === "https:" ? [{ url: url.href, label: cellText(match[2]).replace(/\s+/g, " ").trim() }] : [];
    } catch { return []; }
  });
}

const OFFICE = "(?:Lieutenant Governor|Governor|Secretary of State|Attorney General|State Auditor|Auditor|State Treasurer|Treasurer|Comptroller|Mayor)";
const namedOffice = new RegExp(`^(${OFFICE})\\s+([A-Z][\\p{L}.'’ -]+)$`, "u");

/** National sources are acquisition inputs. The ordinary §3 publisher checks
 * the saved official document and correct seat before they enter the reader.
 * The caller supplies the shared held-first source reader/vault; no per-ZIP files. */
export async function collectNationalPlaceSources(input: {
  readonly divisions: readonly PlaceDivision[];
  readonly now: string;
  readonly read: (url: string) => Promise<HeldSourcePage>;
}): Promise<NationalPlaceSources> {
  const documents = new Map<string, HeldSourcePage>();
  const inFlight = new Map<string, Promise<HeldSourcePage>>();
  const gaps: { sourceUrl: string; detail: string }[] = [];
  const read = (url: string) => {
    const prior = inFlight.get(url);
    if (prior) return prior;
    const pending = input.read(url).then(page => { documents.set(url, page); return page; });
    inFlight.set(url, pending);
    return pending;
  };
  const attempt = async (url: string) => {
    try { return await read(url); }
    catch (error) { gaps.push({ sourceUrl: url, detail: error instanceof Error ? error.message : String(error) }); return null; }
  };
  const states = [...new Set(input.divisions.flatMap(d => /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})/.exec(d.id)?.[1] ?? []))];
  const officials: NationalOfficialCandidate[] = [];
  const electionDocuments: HeldSourcePage[] = [];
  const directory = await attempt("https://www.usa.gov/state-governments");
  await Promise.all(states.map(async state => {
    const csv = await attempt(bulkUrl(state));
    if (csv) {
      const issue = pluralRosterIssue(csv.text);
      if (issue) gaps.push({ sourceUrl: csv.url, detail: issue });
      else {
        const roster = normalize(rowsToPeople(csv.text, state), indexDivisions(input.divisions.map(d => ({ ...d, ocdId: d.id }))), csv.collectedAt, state);
        const memberships = new Map(roster.divisions.map(d => [d.officeholderId, d.ocdId]));
        await Promise.all(roster.officeholders.filter(person => memberships.has(person.id)).map(async person => {
          if (!person.websiteUrl) return;
          const document = await attempt(person.websiteUrl);
          if (!document) return;
          const text = cellText(document.text).replace(/\s+/g, " ");
          // Prefer the source's own spelling (middle initials, formal first
          // names), without claiming a cross-source person-identity merge.
          const heading = cellText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(document.text)?.[1] ?? "")
            .replace(/^(?:State )?(?:Senator|Representative|Delegate|Assemblymember)\s+/i, "")
            .replace(/\s*[-–—]\s*District\s+.*$/i, "").trim();
          const name = text.includes(person.name) ? person.name : /^[\p{L}.'’ -]+$/u.test(heading) && heading.split(/\s+/).length >= 2 && heading.length < 100 ? heading : null;
          const at = name ? text.indexOf(name) : -1;
          if (!name || at < 0) { gaps.push({ sourceUrl: document.url, detail: `The official profile needs name extraction for ${person.name}` }); return; }
          officials.push({ discoveryId: person.id, divisionId: memberships.get(person.id)!, name,
            officeTitle: person.officeTitle, officialUrl: person.websiteUrl, document,
            quote: text.slice(Math.max(0, at - 100), at + name.length + 160) });
        }));
      }
    }
    if (!directory) return;
    const anchor = [...directory.text.matchAll(/<a\b([^>]+)>[\s\S]*?<\/a>/gi)]
      .find(m => new RegExp(`\\bid=["']${state}["']`, "i").test(m[1]));
    const path = anchor && /href=["']([^"']+)["']/i.exec(anchor[1])?.[1];
    if (!path) { gaps.push({ sourceUrl: directory.url, detail: `The national directory has no ${state.toUpperCase()} link` }); return; }
    const statePage = await attempt(new URL(path, directory.url).href);
    if (!statePage) return;
    const divisionId = input.divisions.find(d => d.divisionType === "state" && d.id.endsWith(`:${state}`))?.id;
    if (!divisionId) return;
    const stateLinks = links(statePage);
    const addOfficials = (page: HeldSourcePage) => {
      for (const link of links(page)) {
        const match = namedOffice.exec(link.label);
        if (!match || /^(?:Contact|Office|About)\b/.test(match[2])) continue;
        officials.push({ discoveryId: `${divisionId}#${match[1].toLowerCase().replace(/\s+/g, "-")}`,
          divisionId, name: match[2].trim(), officeTitle: match[1], officialUrl: link.url, document: page, quote: link.label });
      }
      for (const member of extractRoster(page.url, page.text).members) {
        if (!member.officeTitle || !new RegExp(`^${OFFICE}$`, "i").test(member.officeTitle)) continue;
        const text = cellText(page.text).replace(/\s+/g, " ");
        const at = text.indexOf(member.name);
        if (at < 0) continue;
        officials.push({ discoveryId: `${divisionId}#${member.officeTitle.toLowerCase().replace(/\s+/g, "-")}`,
          divisionId, name: member.name, officeTitle: member.officeTitle, officialUrl: page.url, document: page,
          quote: text.slice(Math.max(0, at - 100), at + member.name.length + 160) });
      }
    };
    addOfficials(statePage);
    const government = /field--name-field-website[\s\S]*?href=["']([^"']+)/i.exec(statePage.text)?.[1];
    if (government) {
      const page = await attempt(government) ?? await attempt(new URL(government).origin);
      if (page) {
        addOfficials(page);
        const offices = [...new Set(links(page).filter(l => /elected officials|state officials|executive branch|leadership/i.test(l.label)).map(l => l.url))];
        await Promise.all(offices.map(async url => { const found = await attempt(url); if (found) addOfficials(found); }));
      }
    }
    const elections = [...new Set(stateLinks.filter(l => /election|voting/i.test(l.label) && new URL(l.url).hostname !== "www.usa.gov").map(l => l.url))];
    await Promise.all(elections.map(async url => {
      const page = await attempt(url);
      if (!page) return;
      electionDocuments.push(page);
      const routes = [...new Set(links(page).filter(l => /registration|deadline|early voting|polling|voting location|certified|canvass|election results/i.test(l.label)).map(l => l.url))];
      await Promise.all(routes.map(async route => { const document = await attempt(route); if (document) electionDocuments.push(document); }));
    }));
  }));
  return { officials: [...new Map(officials.map(o => [`${o.divisionId}|${o.officeTitle}|${o.name}`, o])).values()],
    electionDocuments, documents: [...documents.values()], gaps };
}
