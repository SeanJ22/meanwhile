/** The row shape needed, declared structurally: this runs on the client against the wire shape, not the server type. */
export interface CommitteeSeat {
  committeeId: string;
  name: string;
  title: string | null;
  jurisdiction?: string | null;
  jurisdictionSource?: string | null;
}

/** Parents and their subcommittees, told apart by id length (a parent's id is four characters). */

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

  // Parents first, in the source's own order.
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
