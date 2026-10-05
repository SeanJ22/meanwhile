"use client";

/**
 * The command center's shared state, handed to every screen: the data bundle,
 * the selected scope, the connection, the viewer's access, the receipts, and
 * the three ways to move (open a detail, change screen, change scope) plus the
 * one way to act (open an action preview).
 */
import { createContext, useContext } from "react";

import type { ActionDef } from "./actions.ts";
import type { SectionId } from "./contract.ts";
import type { Access, Connection } from "./eligibility.ts";
import type { ActionRef, AdminV6Data, Hunt, Place, UiReceipt } from "./model.ts";
import type { PlaceIndex } from "./places.ts";

import type { View } from "./view-param.ts";

export type { View };
export const VIEWS: readonly (readonly [View, string])[] = [
  ["now", "Now"],
  ["workers", "Workers"],
  ["work", "Work"],
  ["checklist", "Checklist"],
  ["money", "Money"],
  ["learning", "Is it learning"],
  ["fix", "Fix list"],
  ["settings", "Settings"],
  ["reports", "Reports"],
  ["changes", "Changes"],
  ["chat", "Ask the console"],
];

export type Detail =
  | { readonly type: "result"; readonly id: string }
  | { readonly type: "stuck"; readonly id: string }
  | { readonly type: "item"; readonly key: string }
  | { readonly type: "system"; readonly group: string }
  | { readonly type: "fix"; readonly id: string }
  | { readonly type: "search"; readonly query: string };

export interface V6 {
  readonly data: AdminV6Data;
  readonly mode: "live" | "sample";
  readonly scopeKey: string;
  readonly place: Place;
  readonly places: readonly Place[];
  readonly index: PlaceIndex;
  readonly hunts: readonly Hunt[];
  readonly connection: Connection;
  readonly access: Access;
  readonly receipts: readonly UiReceipt[];
  readonly period: string;
  go(view: View): void;
  open(detail: Detail): void;
  setScope(key: string): void;
  /** Why this control is off, or null when it can be used. */
  whyNot(ref: ActionRef): string | null;
  act(ref: ActionRef): void;
  check(receipt: UiReceipt): void;
  canCheck(receipt: UiReceipt): string | null;
  defOf(ref: ActionRef): ActionDef;
  nameOf(id: string): string;
  /** Live paged sections: send search, filters or a cursor to the server. A no-op for local data. */
  query(section: SectionId, params: Readonly<Record<string, string>>): void;
}

export const V6Context = createContext<V6 | null>(null);

export function useV6(): V6 {
  const v = useContext(V6Context);
  if (!v) throw new Error("Admin v6 screens must render inside the command center");
  return v;
}
