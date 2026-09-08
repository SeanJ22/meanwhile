/**
 * The selection rules a contest can use, independent of any storage or UI.
 *
 * Current ballot records expose `voteFor`, so `methodFromVoteFor` maps those
 * contests to VOTE_FOR_1 or VOTE_FOR_N without changing their data shape.
 * RANKED_CHOICE is modeled here so ordered state has one honest contract when
 * a jurisdiction using it is added; this module does not create a ranked UI.
 */
export type ContestSelectionMethod =
  | { kind: "VOTE_FOR_1" }
  | { kind: "VOTE_FOR_N"; limit: number }
  | { kind: "RANKED_CHOICE"; limit: number };

export interface OrderedSelectionState {
  /** Choice ids in the order the reader placed them. */
  orderedChoiceIds: readonly string[];
}

export type SelectionStatus =
  | "ADDED"
  | "REMOVED"
  | "REPLACED"
  | "LIMIT_REACHED"
  | "MOVED"
  | "UNCHANGED";

export interface SelectionTransition {
  state: OrderedSelectionState;
  status: SelectionStatus;
  /** Choices removed because this method replaces rather than appends. */
  displacedChoiceIds: readonly string[];
}

function positiveLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

export function methodFromVoteFor(voteFor: number): ContestSelectionMethod {
  const limit = positiveLimit(voteFor);
  return limit === 1 ? { kind: "VOTE_FOR_1" } : { kind: "VOTE_FOR_N", limit };
}

export function selectionLimit(method: ContestSelectionMethod): number {
  return method.kind === "VOTE_FOR_1" ? 1 : positiveLimit(method.limit);
}

function unique(ids: readonly string[]): string[] {
  return ids.filter((id, index) => id.length > 0 && ids.indexOf(id) === index);
}

/**
 * Apply a tap to ordered selection state.
 *
 * A one-winner contest replaces its prior choice. A vote-for-N or ranked
 * contest refuses an extra choice explicitly at its limit; it never silently
 * evicts an earlier choice. Tapping a selected choice removes it.
 */
export function applyContestSelection(
  method: ContestSelectionMethod,
  current: OrderedSelectionState,
  choiceId: string,
): SelectionTransition {
  const before = unique(current.orderedChoiceIds);
  const existingIndex = before.indexOf(choiceId);

  if (existingIndex >= 0) {
    return {
      state: {
        orderedChoiceIds: before.filter((id) => id !== choiceId),
      },
      status: "REMOVED",
      displacedChoiceIds: [],
    };
  }

  if (method.kind === "VOTE_FOR_1") {
    return {
      state: { orderedChoiceIds: [choiceId] },
      status: before.length > 0 ? "REPLACED" : "ADDED",
      displacedChoiceIds: before,
    };
  }

  if (before.length >= selectionLimit(method)) {
    return {
      state: { orderedChoiceIds: before },
      status: "LIMIT_REACHED",
      displacedChoiceIds: [],
    };
  }

  return {
    state: { orderedChoiceIds: [...before, choiceId] },
    status: "ADDED",
    displacedChoiceIds: [],
  };
}

/**
 * Reposition one selected choice. Only ranked-choice state has positional
 * meaning; plurality methods return the state unchanged. This gives a future
 * ranked UI a pure operation without implying that such a UI exists today.
 */
export function moveOrderedChoice(
  method: ContestSelectionMethod,
  current: OrderedSelectionState,
  choiceId: string,
  toIndex: number,
): SelectionTransition {
  const before = unique(current.orderedChoiceIds).slice(0, selectionLimit(method));
  if (method.kind !== "RANKED_CHOICE") {
    return {
      state: { orderedChoiceIds: before },
      status: "UNCHANGED",
      displacedChoiceIds: [],
    };
  }

  const fromIndex = before.indexOf(choiceId);
  if (fromIndex < 0 || before.length < 2) {
    return {
      state: { orderedChoiceIds: before },
      status: "UNCHANGED",
      displacedChoiceIds: [],
    };
  }

  const next = [...before];
  next.splice(fromIndex, 1);
  const destination = Math.max(0, Math.min(Math.trunc(toIndex), next.length));
  next.splice(destination, 0, choiceId);

  return {
    state: { orderedChoiceIds: next },
    status: destination === fromIndex ? "UNCHANGED" : "MOVED",
    displacedChoiceIds: [],
  };
}
