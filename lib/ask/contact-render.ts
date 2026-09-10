import { formatDateLong } from "../text/format-date.ts";

interface ContactReadAttribution {
  readonly sourceOrg: string | null;
  readonly retrievedAt: string | null;
}

/** Client-safe attribution wording over contact bytes projected by the route. */
export function contactReadLine<T extends ContactReadAttribution>(contact: T): string | null {
  const org = contact.sourceOrg?.trim() || null;
  const on = formatDateLong(contact.retrievedAt);
  if (org && on) return `${org}, read ${on}`;
  if (org) return org;
  if (on) return `read ${on}`;
  return null;
}
