/**
 * **WHEN TWO STORED AGENDA ROWS ARE THE SAME DOCUMENT CONTENT.** (2026-09-22.)
 *
 * The retrieval pass stores a new row whenever a fetch's bytes hash
 * differently, and some publisher pages never hash the same way twice: Tucson
 * Unified's MeetingInformation page was stored 88 times in four days with the
 * identical extracted text. A byte hash is a fact about the transfer; the
 * words are the document. So one rule, used by the ingest's append-only store,
 * the promotion change set and the reader's version count alike:
 *
 *   two rows carry the same content when their readable text is identical
 *   (whitespace runs are layout, not content) OR their bytes are identical.
 *
 * A row with no readable text is compared by its bytes alone, so a failed
 * extraction can never be declared equal to a different document.
 *
 * Pure and dependency-free on purpose: the reader's agenda card imports the
 * same rule in the browser bundle, and a server-only helper would fork it.
 */

export interface AgendaContentRow {
  readonly text: string | null;
  readonly contentHash?: string | null;
}

/**
 * **THE NAME OF THE SIGNAL THAT A READ WAS THE PUBLISHER'S PAGE.** (2026-09-23.)
 *
 * An HTML page whose readable text is word for word what the same publisher
 * serves for a DIFFERENT sitting says nothing about either sitting: the words
 * are the page, not the document. The retrieval records such a read as a
 * failed extraction whose note opens with this name (RULING 269: a read that
 * returned nothing of the document is a failed read), and the reader
 * recognises the note by the same constant, so the two cannot drift.
 */
export const PUBLISHER_PAGE_SIGNAL = "Same words as another meeting's page";

/** Is this extraction note the publisher-page signal? */
export function isPublisherPageNote(note: string | null | undefined): boolean {
  return typeof note === "string" && note.startsWith(`${PUBLISHER_PAGE_SIGNAL}:`);
}

/** Readable text as a reader meets it, or null when the row holds none. */
export function agendaReadableText(row: AgendaContentRow): string | null {
  const text = row.text?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Identical readable text, or identical bytes. */
export function sameAgendaContent(left: AgendaContentRow, right: AgendaContentRow): boolean {
  const leftHash = left.contentHash || null;
  if (leftHash !== null && leftHash === (right.contentHash || null)) return true;
  const leftText = agendaReadableText(left);
  return leftText !== null && leftText === agendaReadableText(right);
}

/**
 * Partition rows into distinct contents. Sameness is transitive across both
 * identities — a row sharing text with one row and bytes with another joins
 * all three. Each group keeps the input order, and groups are ordered by their
 * first member, so a caller that sorts its input decides which row speaks for
 * each content.
 */
export function agendaContentGroups<T extends AgendaContentRow>(rows: readonly T[]): T[][] {
  const parent = rows.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== root) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    // The earlier row always remains the group's first member.
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  const byHash = new Map<string, number>();
  const byText = new Map<string, number>();
  rows.forEach((row, index) => {
    const hash = row.contentHash || null;
    if (hash !== null) {
      const seen = byHash.get(hash);
      if (seen === undefined) byHash.set(hash, index);
      else union(seen, index);
    }
    const text = agendaReadableText(row);
    if (text !== null) {
      const seen = byText.get(text);
      if (seen === undefined) byText.set(text, index);
      else union(seen, index);
    }
  });
  const groups = new Map<number, T[]>();
  rows.forEach((row, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(row);
    groups.set(root, group);
  });
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([, group]) => group);
}
