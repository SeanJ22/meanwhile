/** Every published number for one official, collected once: more than one is a chooser, exactly one a direct link. */

export interface PhoneChoice {
  /** As the source published it. Never reformatted — see below. */
  phone: string;
  /** The office this number rings, from the recorded data; never inferred from an area code. */
  label: string;
}

/** A district office as the directory publishes it — city and number only. */
export interface OfficePhone {
  city: string | null;
  phone: string | null;
}

/** Keep a published extension separate with RFC 3966's `ext`. The displayed number keeps its published formatting. */
export function telHref(phone: string): string {
  const extension = /\s*(?:ext(?:ension)?\.?\s*|x\s*|;ext=)(\d+)\s*$/i.exec(phone);
  const number = extension ? phone.slice(0, extension.index) : phone;
  return `tel:${number.replace(/[^\d+]/g, "")}${extension ? `;ext=${extension[1]}` : ""}`;
}

/** District numbers first, then the Washington line; offices sharing a number collapse to one entry. */
export function phoneChoicesFor(input: {
  /** The holder's own number. For a federal member this is the DC line. */
  phone: string | null;
  /** The federal directory's offices. Empty for every other tier. */
  districtOffices?: OfficePhone[];
  /** What to call the holder's own number beside district numbers; for federal members it is the Washington line. */
  ownLabel?: string;
}): PhoneChoice[] {
  const choices: PhoneChoice[] = [];
  const seen = new Set<string>();

  for (const office of input.districtOffices ?? []) {
    if (!office.phone) continue;
    if (seen.has(office.phone)) continue;
    seen.add(office.phone);
    choices.push({
      phone: office.phone,
      // The city where one is published, so rows are told apart by what differs. Never an invented place.
      label: office.city ? `${office.city} office` : "District office",
    });
  }

  if (input.phone && !seen.has(input.phone)) {
    seen.add(input.phone);
    choices.push({
      phone: input.phone,
      label: input.ownLabel ?? "Office",
    });
  }

  return choices;
}
