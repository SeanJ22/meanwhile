"use client";

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import { INITIAL_STATE, uiReducer } from "./reducer";
import type { UiAction, UiState } from "./types";

/**
 * One store for the shared UI state.
 *
 * State and dispatch are two contexts rather than one object, so a component
 * that only dispatches — a button, a chip — does not re-render every time an
 * unrelated field changes. `dispatch` is referentially stable for the life of
 * the provider, so those components effectively never re-render.
 */

const StateContext = createContext<UiState | null>(null);
const DispatchContext = createContext<Dispatch<UiAction> | null>(null);

export function UiProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Test seam. Production mounts with the module default. */
  initial?: Partial<UiState>;
}) {
  const [state, dispatch] = useReducer(
    uiReducer,
    useMemo(() => ({ ...INITIAL_STATE, ...initial }), [initial]),
  );

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useUi(): UiState {
  const state = useContext(StateContext);
  if (!state) throw new Error("useUi must be used inside <UiProvider>");
  return state;
}

export function useUiDispatch(): Dispatch<UiAction> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error("useUiDispatch must be used inside <UiProvider>");
  return dispatch;
}
