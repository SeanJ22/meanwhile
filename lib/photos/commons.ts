import { sharedNameForm } from "../identity/name-forms.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { decodeEntities } from "../sources/http.ts";
import { freelyLicensedPortrait, type CommonsCandidacyIdentity, type PortraitVerification } from "./binding.ts";
export type { CommonsCandidacyIdentity } from "./binding.ts";
import type { PortraitCapture, PortraitSources } from "./evidence.ts";

const words = (value: string) => ` ${value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

const fileName = (value: string): string => {
  const url = new URL(value);
  return decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/_/g, " ");
};

export function wikidataCandidacyPortraitIdentity(identity: CommonsCandidacyIdentity, name: string, text: string): string | null {
  if (!/^Q\d+$/.test(identity.wikidataId) || !identity.candidacyId ||
      /\/state:([^/]+)/.exec(identity.ocdId)?.[1].toUpperCase() !== identity.stateCode.toUpperCase()) return null;
  const office = officeIdentity(identity.officeTitle);
  if (!office) return null;
  try {
    const rows = JSON.parse(text).results?.bindings;
    if (!Array.isArray(rows)) return null;
    const seat = /\/(cd|sldu|sldl):([^/]+)/.exec(identity.ocdId);
    const district = seat?.[2];
    const matches = rows.filter(row => {
      const value = (key: string): string => typeof row[key]?.value === "string" ? row[key].value : "";
      const state = value("stateCode").replace(/^US-/, "").toUpperCase();
      const districtName = value("districtLabel");
      const districtNumber = value("districtNumber") || /(?:district\s+|\b)(\d+)(?:st|nd|rd|th)?(?:\s+(?:congressional|legislative|senate|house))?\s+district\b/i.exec(districtName)?.[1] ||
        /\bdistrict\s+(\d+)\b/i.exec(districtName)?.[1];
      const districtType = seat?.[1] === "cd" ? /congressional|u\.?s\.? house/i.test(districtName)
        : seat?.[1] === "sldu" ? /state senate|senatorial|legislative council/i.test(districtName)
          : /state house|assembly|house of representatives/i.test(districtName);
      return value("person").split("/").at(-1) === identity.wikidataId &&
        sharedNameForm(value("personLabel"), name) !== null && state === identity.stateCode.toUpperCase() &&
        (district ? districtNumber === district && (districtType || officeIdentity(value("officeLabel")) === office) && (!value("officeLabel") || officeIdentity(value("officeLabel")) === office) : officeIdentity(value("officeLabel")) === office) && Boolean(value("image"));
    });
    const images = [...new Set<string>(matches.map(row => row.image.value))];
    return images.length === 1 ? images[0] : null;
  } catch { return null; }
}

export function verifiedCommonsPortrait(input: PortraitSources, captures: readonly PortraitCapture[], now: string):
  Omit<PortraitVerification, "imageHash" | "sourceImageHash"> | null {
  const identity = input.commons;
  if (!identity || identity.candidacyId !== input.subject.personId) return null;
  const identityCapture = identity.wikidataId === "" ? null : captures.find(capture => {
    const url = new URL(capture.evidence.canonicalUrl);
    if (url.hostname !== "query.wikidata.org" || url.pathname !== "/sparql") return false;
    const image = wikidataCandidacyPortraitIdentity(identity, input.subject.name, capture.evidence.text);
    return image !== null && ["commons.wikimedia.org", "upload.wikimedia.org"].includes(new URL(image).hostname) && fileName(image) === fileName(input.imageUrl);
  });
  if (identityCapture === undefined || new URL(input.imageUrl).hostname !== "upload.wikimedia.org") return null;
  for (const capture of captures) {
    const url = new URL(capture.evidence.canonicalUrl);
    if (url.hostname !== "commons.wikimedia.org" || url.pathname !== "/w/api.php") continue;
    try {
      const pages = Object.values(JSON.parse(capture.evidence.text).query?.pages ?? {}) as { title?: string; imageinfo?: { url?: string; extmetadata?: Record<string, { value?: string }> }[] }[];
      for (const page of pages) {
        if (page.title?.replace(/^File:/, "").replace(/_/g, " ") !== fileName(input.imageUrl)) continue;
        for (const info of page.imageinfo ?? []) {
          const metadata = info.extmetadata;
          const license = metadata?.LicenseShortName?.value?.trim() ?? "";
          const author = decodeEntities((metadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "")).trim();
          if (info.url !== input.imageUrl || !freelyLicensedPortrait(license) || !author) continue;
          // Without a Wikidata match, the file's own description must name the person.
          const described = decodeEntities(`${metadata?.ObjectName?.value ?? ""} ${metadata?.ImageDescription?.value ?? ""}`.replace(/<[^>]+>/g, " "));
          if (identityCapture === null && !words(described).includes(words(input.subject.name))) continue;
          return { personId: input.subject.personId, name: input.subject.name, imageUrl: input.imageUrl, checkedAt: now,
            basis: "COMMONS", commons: { ...identity, identitySourceUrl: (identityCapture ?? capture).evidence.canonicalUrl },
            attribution: { sourceUrl: capture.evidence.canonicalUrl, name: input.subject.name, author },
            license: { value: license, sourceUrl: capture.evidence.canonicalUrl, quote: license },
            sources: [...identityCapture ? [identityCapture] : [], capture].map(row => ({ url: row.evidence.canonicalUrl,
              ...(row.evidence.artifactId ? { artifactId: row.evidence.artifactId } : { vaultKey: row.evidence.vaultKey }),
              contentHash: row.evidence.contentHash, retrievedAt: row.evidence.retrievedAt })) };
        }
      }
    } catch {}
  }
  return null;
}
