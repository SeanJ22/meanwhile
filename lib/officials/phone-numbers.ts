/**
 * **Every published number for one official, collected once** — R39,
 * 2026-08-17, the author's production feedback.
 *
 * ## Why this is a module and not four lines in a component
 *
 * The rule R39 encodes is a COUNT rule: more than one number is a modal,
 * exactly one is a direct `tel:` link, and the two shapes must never disagree
 * about how many numbers an official has. A count computed inside the render
 * that decides the shape can only be tested by reading the render, and the
 * defect being fixed here — seven stacked pills on Jeanne Shaheen's card — is
 * exactly what "the render decides" looks like when nobody can assert on it.
 *
 * So: collect here, assert here, render from the answer.
 */

export interface PhoneChoice {
  /** As the source published it. Never reformatted — see below. */
  phone: string;
  /**
   * The office this number rings, from the RECORDED data.
   *
   * Never inferred from an area code. An office label is a claim about where
   * a public official's line goes, and an area code is a claim about where a
   * number was issued; treating one as the other is a generated claim wearing
   * the register of a researched one. Where the record names no office, the
   * label says so in the recorded data's own terms rather than guessing.
   */
  label: string;
}

/** A district office as the directory publishes it — city and number only. */
export interface OfficePhone {
  city: string | null;
  phone: string | null;
}

/**
 * Keep an explicitly published extension separate from the subscriber number
 * using RFC 3966's `ext` parameter; concatenating it dials a different number.
 *
 * The DISPLAYED number keeps its published formatting — parentheses, dashes,
 * dots, all of it. A number we reformatted is a number we typed rather than
 * one they published, and this product's whole claim is the difference.
 */
export function telHref(phone: string): string {
  const extension = /\s*(?:ext(?:ension)?\.?\s*|x\s*|;ext=)(\d+)\s*$/i.exec(phone);
  const number = extension ? phone.slice(0, extension.index) : phone;
  return `tel:${number.replace(/[^\d+]/g, "")}${extension ? `;ext=${extension[1]}` : ""}`;
}

/**
 * District numbers first, then the Washington line.
 *
 * District first because it is the one that answers — g4 item 8's finding,
 * unchanged by R39. R39 changed only what happens to the list afterwards.
 *
 * Two dedupes, both of them the "stated N equals rendered rows" rule in the
 * small:
 *
 * - Offices sharing a switchboard collapse to one entry. A member with four
 *   offices behind one number has one number, and four identical rows in a
 *   chooser is the wall this was built to remove, rebuilt inside the fix.
 * - A Washington number that IS one of the district numbers is not a second
 *   number. It keeps the district office's label, because that is the label
 *   the record actually supports for it.
 */
export function phoneChoicesFor(input: {
  /** The holder's own number. For a federal member this is the DC line. */
  phone: string | null;
  /** The federal directory's offices. Empty for every other tier. */
  districtOffices?: OfficePhone[];
  /**
   * What to call the holder's own number when district numbers sit beside it.
   * Federal members' term records ARE the Washington office's line, which is
   * why this is a recorded fact and not a guess.
   */
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
      // The city where one is published, so two rows are told apart by the
      // thing that actually differs between them. Never an invented place.
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
