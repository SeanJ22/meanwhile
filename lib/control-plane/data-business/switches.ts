import { readRuntimeAdminConfig } from "../runtime-admin-config.ts";
/**
 * A switch per recipe per audience: Admin, the dashboard, one named customer. The switches live on the owner's config row (`dataSwitches`, set through the
 * gateway's `config.setDataSwitch` with the receipt that set each), and `readRecipe` asks `switchOn` before it reads any data.
 * With no entry the default is: **Admin on; the dashboard and every customer off.** Nothing leaves until the owner flips a switch.
 * A config that cannot be read is never ON for an audience outside Admin.
 *
 * Read at each read, not at a runner's cycle start, so a flip takes effect on the next read and no runner has to pick it up.
 */
import { dataSwitchOf, isAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { Audience } from "./types.ts";
import { isAudience } from "./types.ts";
import { RECIPES, type Recipe } from "./recipes.ts";

/** What an audience gets when the owner has not decided: Admin, yes; everyone else, no. */
export const defaultOn = (audience: string): boolean => audience === "admin";

/** Is this recipe on for this audience? The owner's entry wins, else the default. A bad audience is never on. */
export function switchOn(config: AdminConfig | null, recipe: string, audience: string): boolean {
  if (!isAudience(audience)) return false;
  const decided = dataSwitchOf(config, recipe, audience);
  return decided !== null ? decided.on : defaultOn(audience);
}

export interface SwitchCell {
  readonly audience: Audience;
  readonly on: boolean;
  /** True when the owner flipped it; false when it is the default. */
  readonly decided: boolean;
  readonly setAt: string | null;
}
export interface SwitchRow {
  readonly recipe: string;
  readonly label: string;
  readonly says: string;
  readonly cells: readonly SwitchCell[];
}

/** The customers the owner has flipped any switch for, sorted. Admin and the dashboard are always columns. */
export function customersOf(config: AdminConfig | null): readonly Audience[] {
  const ids = new Set<Audience>();
  for (const d of config?.dataSwitches ?? []) if (typeof d?.audience === "string" && d.audience.startsWith("customer:") && isAudience(d.audience)) ids.add(d.audience);
  return [...ids].sort();
}

/** Every recipe on the menu with its switch for Admin, the dashboard and each customer the owner has set one for. */
export function switchTable(config: AdminConfig | null, book: readonly Recipe[] = RECIPES): readonly SwitchRow[] {
  const audiences: readonly Audience[] = ["admin", "dashboard", ...customersOf(config)];
  return book.map((r) => ({
    recipe: r.id, label: r.label, says: r.says,
    cells: audiences.map((audience) => {
      const decided = dataSwitchOf(config, r.id, audience);
      return { audience, on: decided !== null ? decided.on : defaultOn(audience), decided: decided !== null, setAt: decided?.setAt ?? null };
    }),
  }));
}

/** The config row as `switchOn` may use it: a row never written is the defaults; one that cannot be read or is not a config is none. */
export async function readSwitchConfig(repos: ControlPlaneRepositories): Promise<AdminConfig | null> {
  try {
    const row = await readRuntimeAdminConfig(repos, ["dataSwitches"]);
    return row !== null && isAdminConfig(row.value) ? row.value : null;
  } catch {
    return null;
  }
}
