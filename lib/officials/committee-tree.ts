/**
 * The row shape this needs, structurally.
 *
 * NOT `DirectoryCommittee` from `./directory.ts`: that is the SERVER type, and
 * this module runs on the client against the wire shape from
 * `hooks/use-member-directory.ts`, which carries the jurisdiction fields the
 * route joins on. Importing the server type would also drag the `node:fs`
 * snapshot graph into a client bundle. Structural on purpose — the two shapes
 * agree on the three fields the tree is built from, and the day they stop
 * agreeing a compile error is the right outcome.
 */
export interface CommitteeSeat {
  committeeId: string;
  name: string;
  title: string | null;
  jurisdiction?: string | null;
  jurisdictionSource?: string | null;
}

/**
 * **Parents and their subcommittees, told apart** — F01 4.2, 2026-08-19.
 *
 * ## Item 0a, answered from the authoritative source
 *
 * The author asked, before this could be built: *"I'm looking at Senate
 * Committee on Armed Services and then under that: ranking member Senate
 * Committee on Armed Services / Senate Committee on Armed Services Emerging
 * Threats and Capabilities. I assume these are subcommittees."*
 *
 * They are — all of them. Read off `data/congress-legislators/directory.json`
 * (unitedstates/congress-legislators, SHA `44582443`, collected 2026-08-16) and
 * re-confirmed against the live file on 2026-08-19, Mark Kelly's Armed Services
 * rows are:
 *
 * | id       | title          | name                                              |
 * |----------|----------------|---------------------------------------------------|
 * | `SSAS`   | —              | Senate Committee on Armed Services                 |
 * | `SSAS14` | Ranking Member | Senate Committee on Armed Services — Airland       |
 * | `SSAS20` | —              | … — Emerging Threats and Capabilities              |
 * | `SSAS16` | —              | … — Strategic Forces                               |
 *
 * So the middle row is **not** a role notation on the parent, which is what it
 * looked like on screen: it is a SUBCOMMITTEE (Airland) that he is ranking
 * member OF, and the card truncated the distinguishing half. Two different
 * things needing two different treatments, as the author suspected — but the
 * split is not where the render implied. `title` is a role notation that can
 * ride on EITHER a parent row or a child row; the `— Subcommittee` suffix is
 * what makes a row a child.
 *
 * ## The convention, verified rather than assumed
 *
 * A parent's `thomas_id` is four characters; a subcommittee's is the parent's
 * id plus a two-digit suffix, and its `name` is always exactly
 * `"<parent name> — <subcommittee name>"`. Checked across all 230 committees in
 * the snapshot: **0 orphans, 0 name mismatches**, and across all 537 members,
 * **0 subcommittee seats whose parent seat the member does not also hold**.
 * `tests/committee-tree.test.ts` asserts all three against the shipped data, so
 * the day the convention breaks it breaks a test rather than a card.
 *
 * ## What happens when it does break
 *
 * A child whose parent seat is absent is NOT dropped and NOT re-parented. It
 * renders as its own top-level row under its FULL name — which is exactly what
 * shipped before this function existed. Losing a committee seat off a member's
 * card to tidy a hierarchy would be a worse bug than the untidy hierarchy.
 */

export interface CommitteeNode {
  seat: CommitteeSeat;
  /**
   * What to print on the row.
   *
   * For a parent, the committee's name unchanged. For a child, the
   * subcommittee's own name with the parent's name and the separator removed —
   * the parent is directly above it, and repeating it is the repetition that
   * made the relationship unreadable in the first place.
   */
  label: string;
  children: CommitteeNode[];
}

/** The separator congress-legislators composes subcommittee names with. */
const SEPARATOR = " — ";

/** A parent committee's id is four characters; anything longer is a child. */
export function parentIdOf(committeeId: string): string | null {
  return committeeId.length > 4 ? committeeId.slice(0, 4) : null;
}

export function buildCommitteeTree(
  seats: readonly CommitteeSeat[],
): CommitteeNode[] {
  const byId = new Map(seats.map((seat) => [seat.committeeId, seat]));

  const nodes: CommitteeNode[] = [];
  const parentNodes = new Map<string, CommitteeNode>();

  // Parents first, in the source's own order, so the top level is unchanged
  // from what shipped.
  for (const seat of seats) {
    if (parentIdOf(seat.committeeId) !== null) continue;
    const node: CommitteeNode = { seat, label: seat.name, children: [] };
    parentNodes.set(seat.committeeId, node);
    nodes.push(node);
  }

  for (const seat of seats) {
    const parentId = parentIdOf(seat.committeeId);
    if (parentId === null) continue;

    const parentNode = parentNodes.get(parentId);
    if (!parentNode) {
      // The verified-impossible case. It renders whole rather than vanishing.
      nodes.push({ seat, label: seat.name, children: [] });
      continue;
    }

    const parentName = byId.get(parentId)?.name ?? "";
    const prefix = `${parentName}${SEPARATOR}`;
    parentNode.children.push({
      seat,
      // Only strip a prefix that is ACTUALLY there. If the convention ever
      // stops holding, the row keeps its full name and stays truthful.
      label: seat.name.startsWith(prefix) ? seat.name.slice(prefix.length) : seat.name,
      children: [],
    });
  }

  return nodes;
}
