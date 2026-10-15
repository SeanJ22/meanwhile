/** Independent contact facts from the Census government's own directory row. */
export function censusGovernmentContacts(value: (...fields: string[]) => string): {
  contactTitle: string | null; mailingAddress: string | null; website: string | null;
} {
  const street = value("ADDRESS1");
  const zip = value("ZIP"), zip4 = value("ZIP4");
  const postal = zip ? `${zip}${zip4 ? `-${zip4}` : ""}` : "";
  const rawWebsite = value("WEB_ADDRESS", "WEBSITE");
  let website: string | null = null;
  if (rawWebsite) {
    try {
      const url = new URL(/^https?:\/\//i.test(rawWebsite) ? rawWebsite : `http://${rawWebsite}`);
      if (["http:", "https:"].includes(url.protocol) && url.hostname.includes(".")) website = url.href;
    } catch { /* An invalid source value is retained in evidence, not made into a link. */ }
  }
  return {
    contactTitle: value("TITLE") || null,
    mailingAddress: street ? [street, value("ADDRESS2"), value("CITY"), value("STATE", "STATE_ABBR"), postal].filter(Boolean).join(", ") : null,
    website,
  };
}
