import { bulkUrl, indexDivisions, normalize, pluralRosterIssue, rowsToPeople } from "./index.ts";
import { cellText, decodeEntities, extractRoster, looksLikeNameCell } from "../../hunt/roster-page.ts";
import { imagesIn, pickPortraits } from "../../hunt/portrait-pick.ts";
import type { PlaceDivision } from "../../control-plane/expansion/national-geography.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../../civic-data/source-authority.ts";
import { electionPageFields, type ElectionFieldCandidate } from "../../hunt/election-page.ts";
import type { WorkerPublicationCapture } from "../../civic-data/worker-roster-publication.ts";
import { fieldManualForSource, type FieldManualRead } from "../../control-plane/field-manual.ts";

export interface HeldSourcePage {
  readonly url: string;
  /** Final retrieval location for relative links; url remains the saved source identity. */
  readonly baseUrl?: string;
  readonly text: string;
  readonly collectedAt: string;
  /** Metadata for these same bytes in the ordinary shared evidence vault. */
  readonly capture?: WorkerPublicationCapture;
}
export interface NationalOfficialCandidate {
  readonly discoveryId: string;
  readonly divisionId: string;
  readonly name: string;
  readonly officeTitle: string;
  /** Discovery label, not source-verified text or an identity merge. */
  readonly seatLabel?: string;
  readonly officialUrl: string;
  readonly document: HeldSourcePage;
  /** Exact source words, never a claim that the publisher has verified them. */
  readonly quote: string;
  readonly linkingPage?: OfficialLinkingPage;
  readonly portrait?: import("../../photos/evidence.ts").PortraitSources;
  /**
   * Set when the official's own page failed the name-and-seat check and the
   * row is the Open States row for that seat; `document` is then the saved
   * Open States CSV.
   */
  readonly basis?: "OPEN_STATES_ROW";
  /** The saved Open States CSV the row came from, kept so the publisher can fall back to it if the own-page seat check fails there. */
  readonly openStatesCapture?: WorkerPublicationCapture;
}

/** The Open States seat holders on a saved CSV: person, name and the district seat their row is in. */
export function openStatesSeatHolders(csvText: string, state: string, divisions: readonly { readonly ocdId: string; readonly label: string; readonly divisionType: string }[], collectedAt: string):
  readonly { readonly id: string; readonly name: string; readonly officeTitle: string; readonly divisionId: string }[] {
  const roster = normalize(rowsToPeople(csvText, state), indexDivisions(divisions.map(d => ({ ocdId: d.ocdId, label: d.label, divisionType: d.divisionType }))), collectedAt, state);
  const memberships = new Map(roster.divisions.map(d => [d.officeholderId, d.ocdId]));
  return roster.officeholders.flatMap(person => memberships.has(person.id) ? [{ id: person.id, name: person.name, officeTitle: person.officeTitle, divisionId: memberships.get(person.id)! }] : []);
}

/** The kinds of fact this job collects. A family with no open blank is not read. */
export interface NationalSourceFamilies { readonly officials: boolean; readonly elections: boolean }
export const ALL_NATIONAL_FAMILIES: NationalSourceFamilies = { officials: true, elections: true };
/** The checklist families each national source family fills. */
export const NATIONAL_FAMILY_GROUPS: Readonly<Record<keyof NationalSourceFamilies, readonly string[]>> = {
  officials: ["OFF"], elections: ["ELE"],
};
/** Which families still have an open blank, from the place's open blanks. */
export function openNationalFamilies(blanks: readonly { readonly checklistId: string }[]): NationalSourceFamilies {
  const open = (family: keyof NationalSourceFamilies) => blanks.some(blank => NATIONAL_FAMILY_GROUPS[family].includes(blank.checklistId.slice(0, blank.checklistId.indexOf("-"))));
  return { officials: open("officials"), elections: open("elections") };
}

export interface NationalPlaceSources {
  /** The families this pass read. A family with nothing open was skipped. */
  readonly families?: NationalSourceFamilies;
  readonly officials: readonly NationalOfficialCandidate[];
  readonly electionDocuments: readonly HeldSourcePage[];
  readonly electionFields: readonly ElectionFieldCandidate[];
  readonly documents: readonly HeldSourcePage[];
  readonly gaps: readonly { sourceUrl: string; detail: string }[];
}

function links(page: HeldSourcePage): { url: string; label: string }[] {
  return [...page.text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match => {
    try {
      const url = new URL(decodeEntities(match[1]), page.baseUrl ?? page.url);
      return url.protocol === "https:" ? [{ url: url.href, label: cellText(match[2]).replace(/\s+/g, " ").trim() }] : [];
    } catch { return []; }
  });
}

const OFFICE = "(?:Lieutenant Governor|Governor|Secretary of State|Attorney General|State Auditor|Auditor|State Treasurer|Treasurer|Comptroller|Mayor)";
const namedOffice = new RegExp(`^(${OFFICE})\\s+([A-Z][\\p{L}.'’ -]+)$`, "u");
const ELECTION_DIRECTORY = "https://www.eac.gov/voters/register-and-vote-in-your-state";

/** Read the federal directory's actual public GET form, not a state host list. */
export function electionDirectorySelection(page: HeldSourcePage, stateName: string): string | null {
  for (const form of page.text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    if (!/method=["']get["']/i.test(form[1])) continue;
    for (const select of form[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = /\bname=["']([^"']+)["']/i.exec(select[1])?.[1];
      if (!name) continue;
      for (const option of select[2].matchAll(/<option\b[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi)) {
        if (cellText(option[2]).toLowerCase() !== stateName.toLowerCase()) continue;
        const base = page.baseUrl ?? page.url;
        const url = new URL(/\baction=["']([^"']+)["']/i.exec(form[1])?.[1] ?? base, base);
        url.searchParams.set(name, decodeEntities(option[1]));
        return url.href;
      }
    }
  }
  return null;
}

/* National sources are acquisition inputs: the publisher checks the saved
 * official document and the seat before anything reaches the reader. */
/**
 * Which image to offer as an official's portrait. The page is read with the
 * same base the portrait check uses (the saved copy's canonical URL). One
 * name-matched image on the person's own saved page wins over a roster image
 * the page does not show; several name-matched images leave the roster's lead.
 */
export function ownPagePortrait(name: string, document: HeldSourcePage, rosterImageUrl: string | undefined): string | undefined {
  if (!document.capture) return rosterImageUrl;
  const named = pickPortraits(name, imagesIn(document.capture.evidence.text, document.capture.evidence.canonicalUrl));
  if (rosterImageUrl && named.some(image => image.src === rosterImageUrl)) return rosterImageUrl;
  return named.length === 1 ? named[0].src : rosterImageUrl;
}

export async function collectNationalPlaceSources(input: {
  readonly divisions: readonly PlaceDivision[];
  readonly now: string;
  readonly read: (url: string) => Promise<HeldSourcePage>;
  readonly knowledge?: FieldManualRead;
  readonly onSources?: (sources: NationalPlaceSources) => Promise<void>;
  /** Only the families with open blanks are read. Omitted, every family is read. */
  readonly families?: NationalSourceFamilies;
}): Promise<NationalPlaceSources> {
  const families = input.families ?? ALL_NATIONAL_FAMILIES;
  const documents = new Map<string, HeldSourcePage>();
  const inFlight = new Map<string, Promise<HeldSourcePage>>();
  const gaps: { sourceUrl: string; detail: string }[] = [];
  const sourceKnowledge = new Map<string, ReturnType<typeof fieldManualForSource>>();
  const learned = (url: string, state: string) => {
    const key = `${state}|${new URL(url).origin}`;
    if (!sourceKnowledge.has(key)) sourceKnowledge.set(key, input.knowledge ? fieldManualForSource(input.knowledge, url, state) : []);
    return sourceKnowledge.get(key)!;
  };
  const orderRoutes = (urls: readonly string[], state: string) => [...new Set(urls)].sort((a, b) => {
    const rank = (url: string) => {
      const entry = learned(url, state).filter(entry => entry.url === url)
        .sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""))[0];
      return entry?.outcome === "YIELDED" ? 0 : entry?.outcome === "FAILED" || entry?.outcome === "BLOCKED" ? 2 : 1;
    };
    return rank(a) - rank(b);
  });
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
  const electionFields: ElectionFieldCandidate[] = [];
  const offeredOfficials = new Set<NationalOfficialCandidate>();
  const offeredElectionFields = new Set<ElectionFieldCandidate>();
  const flush = async () => {
    if (!input.onSources) return;
    const readyOfficials = officials.filter(row => !offeredOfficials.has(row));
    const readyFields = electionFields.filter(row => !offeredElectionFields.has(row));
    if (!readyOfficials.length && !readyFields.length) return;
    readyOfficials.forEach(row => offeredOfficials.add(row));
    readyFields.forEach(row => offeredElectionFields.add(row));
    await input.onSources({ officials: readyOfficials, electionFields: readyFields,
      electionDocuments: [...electionDocuments], documents: [...documents.values()], gaps: [] });
  };
  // The directory leads to both families; with nothing open in either, nothing is read.
  const directory = families.officials || families.elections ? await attempt("https://www.usa.gov/state-governments") : null;
  let electionDirectory: Promise<HeldSourcePage | null> | undefined;
  await Promise.all(states.map(async state => {
    const csv = families.officials ? await attempt(bulkUrl(state)) : null;
    if (csv) {
      const issue = pluralRosterIssue(csv.text);
      if (issue) gaps.push({ sourceUrl: csv.url, detail: issue });
      else {
        const roster = normalize(rowsToPeople(csv.text, state), indexDivisions(input.divisions.map(d => ({ ...d, ocdId: d.id }))), csv.collectedAt, state);
        const memberships = new Map(roster.divisions.map(d => [d.officeholderId, d.ocdId]));
        await Promise.all(roster.officeholders.filter(person => memberships.has(person.id)).map(async person => {
          // When the own-page check fails, the Open States row fills the seat, marked as such.
          const fallback = (reason: string, at?: string) => {
            const divisionId = memberships.get(person.id)!;
            if (at) gaps.push({ sourceUrl: at, detail: reason });
            if (!csv.capture) return;
            // The chamber's own word for its members in this state, from the Open States row, never read off a page.
            officials.push({ discoveryId: person.id, divisionId, name: person.name, officeTitle: person.officeTitle, seatLabel: person.officeTitle,
              officialUrl: person.websiteUrl ?? csv.url, document: csv, basis: "OPEN_STATES_ROW", quote: `${person.name}, ${person.officeTitle}` });
          };
          if (!person.websiteUrl) { fallback("", undefined); await flush(); return; }
          const document = await attempt(person.websiteUrl);
          if (!document) { fallback("", undefined); await flush(); return; }
          const text = cellText(document.text).replace(/\s+/g, " ");
          // Prefer the source's own spelling (middle initials, formal first
          // names), without claiming a cross-source person-identity merge.
          const heading = cellText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(document.text)?.[1] ?? "")
            .replace(/^(?:State )?(?:Senator|Representative|Delegate|Assemblymember)\s+/i, "")
            .replace(/\s*[-–—]\s*District\s+.*$/i, "").trim();
          const name = looksLikeNameCell(heading) ? heading : text.includes(person.name) ? person.name : null;
          const at = name ? text.indexOf(name) : -1;
          if (!name || at < 0) { fallback(`The official profile needs name extraction for ${person.name}`, document.url); await flush(); return; }
          const divisionId = memberships.get(person.id)!;
          const officePattern = divisionId.includes("/sldu:") ? /\b(?:State\s+)?Senator\b/i
            : /\b(?:State\s+)?(?:Representative|Delegate|Assembly\s*member|Assemblyman|Assemblywoman)\b/i;
          const office = officePattern.exec(text)?.[0];
          if (!office) { fallback(`The official profile needs source seat words for ${name}`, document.url); await flush(); return; }
          // The portrait the person's own page shows under their name wins over
          // the roster's image URL when the two differ.
          const imageUrl = ownPagePortrait(name, document, person.portraitCandidate?.imageUrl);
          officials.push({ discoveryId: person.id, divisionId, name,
            officeTitle: office, seatLabel: person.officeTitle, officialUrl: person.websiteUrl, document, ...(csv.capture ? { openStatesCapture: csv.capture } : {}),
            ...(imageUrl ? {portrait: {imageUrl,
              captures:[csv.capture,document.capture].filter((c): c is WorkerPublicationCapture => c !== undefined)}} : {}),
            quote: text.slice(Math.max(0, at - 100), at + name.length + 160) });
          await flush();
        }));
      }
    }
    if (!directory) return;
    const anchor = [...directory.text.matchAll(/<a\b([^>]+)>[\s\S]*?<\/a>/gi)]
      .find(m => new RegExp(`\\bid=["']${state}["']`, "i").test(m[1]));
    const path = anchor && /href=["']([^"']+)["']/i.exec(anchor[1])?.[1];
    if (!path) { gaps.push({ sourceUrl: directory.url, detail: `The national directory has no ${state.toUpperCase()} link` }); return; }
    const statePage = await attempt(new URL(path, directory.baseUrl ?? directory.url).href);
    if (!statePage) return;
    const divisionId = input.divisions.find(d => d.divisionType === "state" && d.id.endsWith(`:${state}`))?.id;
    if (!divisionId) return;
    const stateLinks = links(statePage);
    const addOfficials = (page: HeldSourcePage, officeHint?: string, linkingPage?: OfficialLinkingPage) => {
      if (!isOfficialSource(page.url, linkingPage)) return;
      const words = cellText(page.text).replace(/\s+/g, " ");
      if (officeHint && words.toLowerCase().includes(officeHint.toLowerCase())) {
        for (const heading of page.text.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
          const label = cellText(heading[2]).replace(/\s+/g, " ").trim();
          const name = label.replace(new RegExp(`^(?:${OFFICE})\\s+`, "i"), "");
          // A site's news carousel can contain several name-shaped H1s.
          // Bind the person to the office in this heading, not elsewhere on
          // the page; a bare heading remains extraction work.
          if (label === name || !looksLikeNameCell(name)) continue;
          if (!/^[\p{Lu}][\p{L}.'’ -]+$/u.test(name) || name.split(/\s+/).length < 2 || name.length > 80 ||
            /\b(?:office|about|contact|state|government|attorney|general|governor|secretary|welcome|news|services)\b/i.test(name)) continue;
          const at = words.indexOf(name);
          if (at < 0) continue;
          officials.push({ discoveryId: `${divisionId}#${officeHint.toLowerCase().replace(/\s+/g, "-")}`,
            divisionId, name, officeTitle: officeHint, officialUrl: page.url, document: page,
            quote: words.slice(Math.max(0, at - 100), at + name.length + 160), linkingPage });
        }
      }
      for (const link of links(page)) {
        const match = namedOffice.exec(link.label);
        if (!match || /^(?:Contact|Office|About)\b/.test(match[2])) continue;
        officials.push({ discoveryId: `${divisionId}#${match[1].toLowerCase().replace(/\s+/g, "-")}`,
          divisionId, name: match[2].trim(), officeTitle: match[1], officialUrl: link.url, document: page, quote: link.label, linkingPage });
      }
      for (const member of extractRoster(page.url, page.text).members) {
        if (!member.officeTitle || !new RegExp(`^${OFFICE}$`, "i").test(member.officeTitle)) continue;
        const text = cellText(page.text).replace(/\s+/g, " ");
        const at = text.indexOf(member.name);
        if (at < 0) continue;
        officials.push({ discoveryId: `${divisionId}#${member.officeTitle.toLowerCase().replace(/\s+/g, "-")}`,
          divisionId, name: member.name, officeTitle: member.officeTitle, officialUrl: page.url, document: page,
          quote: text.slice(Math.max(0, at - 100), at + member.name.length + 160), linkingPage });
      }
    };
    if (families.officials) {
      addOfficials(statePage);
      await flush();
    }
    const stateProvenance = { url: statePage.url, html: statePage.text };
    // Office landing pages often name the office but link a separate biography.
    // Read that profile rather than trying to infer a person from a URL slug.
    const officeLinks = stateLinks.flatMap(link => {
      const office = new RegExp(`^(?:Office of (?:the )?)?(${OFFICE})$`, "i").exec(link.label)?.[1];
      return office ? [{ ...link, office }] : [];
    });
    const followOffice = async (link: { url: string; office: string }, parent: OfficialLinkingPage) => {
      const page = await attempt(link.url);
      if (!page) return;
      addOfficials(page, link.office, parent);
      await flush();
      const provenance = { url: page.url, html: page.text, linkingPage: parent };
      await Promise.all(links(page).filter(l => new RegExp(`^(?:About (?:the )?)?${link.office}$`, "i").test(l.label)).map(async l => {
        const profile = await attempt(l.url);
        if (profile) { addOfficials(profile, link.office, provenance); await flush(); }
      }));
    };
    if (families.officials) await Promise.all(officeLinks.map(link => followOffice(link, stateProvenance)));
    const government = families.officials ? /field--name-field-website[\s\S]*?href=["']([^"']+)/i.exec(statePage.text)?.[1] : undefined;
    if (government) {
      let page = await attempt(government) ?? await attempt(new URL(government).origin);
      if (!page) {
        // A stale landing path does not establish that the government's site
        // is unavailable. Try its other routes published by the directory.
        const alternatives = orderRoutes([
          ...learned(government, state).filter(entry => entry.outcome === "YIELDED").flatMap(entry => entry.url ?? []),
          ...stateLinks.filter(l => l.url !== government && new URL(l.url).origin === new URL(government).origin).map(link => link.url),
        ], state);
        for (const route of alternatives) {
          page = await attempt(route);
          if (page) break;
        }
      }
      if (page) {
        addOfficials(page, undefined, stateProvenance);
        await flush();
        const offices = [...new Set(links(page).filter(l => /elected officials|state officials|executive branch|leadership/i.test(l.label)).map(l => l.url))];
        await Promise.all(offices.map(async url => {
          const found = await attempt(url);
          if (!found) return;
          const parent = { url: page.url, html: page.text, linkingPage: stateProvenance };
          addOfficials(found, undefined, parent);
          await flush();
          await Promise.all(links(found).flatMap(l => {
            const office = new RegExp(`^(?:Office of (?:the )?)?(${OFFICE})(?:\\s+[A-Z][\\p{L}.'’ -]+)?$`, "u").exec(l.label)?.[1];
            return office ? [followOffice({ url: l.url, office }, { url: found.url, html: found.text, linkingPage: parent })] : [];
          }));
        }));
      }
    }
    if (!families.elections) return;
    electionDirectory ??= attempt(ELECTION_DIRECTORY);
    const electionIndex = await electionDirectory;
    const stateName = cellText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(statePage.text)?.[1] ?? "");
    const selection = electionIndex && electionDirectorySelection(electionIndex, stateName);
    const federalElectionPage = selection ? await attempt(selection) : null;
    const elections = new Map([...stateLinks.map(link => ({ ...link, parent: statePage })),
      ...(federalElectionPage ? links(federalElectionPage).map(link => ({ ...link, parent: federalElectionPage })) : [])]
      .filter(l => /election|voting|register|registration|polling|ballot/i.test(l.label) && !/\b(?:usa|eac)\.gov$/.test(new URL(l.url).hostname))
      .map(l => [l.url, { url: l.parent.url, html: l.parent.text }]));
    await Promise.all([...elections].map(async ([url, parent]) => {
      const page = await attempt(url);
      if (!page) return;
      electionDocuments.push(page);
      electionFields.push(...electionPageFields(page, divisionId, parent));
      if (families.officials) addOfficials(page, undefined, parent);
      await flush();
      const provenance = { url: page.url, html: page.text, linkingPage: parent };
      if (families.officials) await Promise.all(links(page).flatMap(l => {
        const office = new RegExp(`^(?:Office of (?:the )?)?(${OFFICE})$`, "i").exec(l.label)?.[1];
        return office ? [followOffice({ url: l.url, office }, provenance)] : [];
      }));
      const routes = orderRoutes([
        ...learned(page.url, state).filter(entry => entry.outcome === "YIELDED" && entry.recordClasses.some(kind => /election|ballot|voter/i.test(kind))).flatMap(entry => entry.url ?? []),
        ...links(page).filter(l => /registration|deadline|early voting|polling|voting location|voting schedule|certified|canvass|election results/i.test(l.label)).map(l => l.url),
      ], state);
      await Promise.all(routes.map(async route => {
        const document = await attempt(route);
        if (!document) return;
        electionDocuments.push(document);
        electionFields.push(...electionPageFields(document, divisionId, provenance));
        await flush();
        await Promise.all(links(document).filter(l => /text.only|accessible version/i.test(l.label)).map(async l => {
          const accessible = await attempt(l.url);
          if (accessible) {
            electionDocuments.push(accessible);
            electionFields.push(...electionPageFields(accessible, divisionId, { url: document.url, html: document.text, linkingPage: provenance }));
            await flush();
          }
        }));
      }));
    }));
  }));
  return { officials: [...new Map(officials.map(o => [`${o.divisionId}|${o.officeTitle}|${o.name}`, o])).values()],
    electionDocuments: [...new Map(electionDocuments.map(d => [d.url, d])).values()],
    electionFields: [...new Map(electionFields.map(f => [`${f.divisionId}|${f.kind}|${f.sourceUrl}|${f.quote}`, f])).values()],
    documents: [...documents.values()], gaps, families };
}
