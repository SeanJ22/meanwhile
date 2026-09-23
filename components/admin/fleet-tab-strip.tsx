/**
 * The tab strip (BUILD.md §0). The Decisions tab is gone (Admin redesign,
 * 2026-09-23): decisions are answered on Fleet · Now, and a second queue
 * would be a competing version of the same control. Each tab is a plain anchor carrying the tab
 * as a URL search param, so it is middle-clickable, reloadable and shareable,
 * and each tab's read stays scoped on the server. No client state.
 */

export type FleetTab = "triage" | "work" | "decisions" | "panels" | "gaps";

export const FLEET_TABS: readonly { readonly id: FleetTab; readonly label: string }[] = [
  { id: "triage", label: "Triage" },
  { id: "work", label: "Work in flight" },
  { id: "panels", label: "Panels" },
  { id: "gaps", label: "Blind spots" },
];

export function parseFleetTab(raw: string | string[] | undefined): FleetTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FLEET_TABS.some((t) => t.id === value) ? (value as FleetTab) : "triage";
}

export function FleetTabStrip({ active, badges }: { readonly active: FleetTab; readonly badges?: Partial<Record<FleetTab, number>> }) {
  return (
    <nav className="fleet-tabs" aria-label="Fleet views">
      {FLEET_TABS.map((t) => {
        const count = badges?.[t.id];
        return (
          <a
            key={t.id}
            href={t.id === "triage" ? "/admin/fleet" : `/admin/fleet?tab=${t.id}`}
            className={`fleet-tab-link${t.id === active ? " fleet-tab-active" : ""}`}
            aria-current={t.id === active ? "page" : undefined}
          >
            {t.label}
            {typeof count === "number" && <span className="fleet-tab-badge">{count}</span>}
          </a>
        );
      })}
    </nav>
  );
}
