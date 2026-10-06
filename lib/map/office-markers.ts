import type { OfficeSite } from "./office-pins.ts";

export interface OfficeMarker {
  setLngLat(point: [number, number]): OfficeMarker;
  getElement(): HTMLElement;
  remove(): void;
}
/** The office layer never enters the meeting pool or its count/filter denominator. */
export function syncOfficeMarkers<M extends OfficeMarker>(pins: Map<string, M>, sites: readonly OfficeSite[],
  create: (button: HTMLButtonElement, site: OfficeSite) => M, onSelect: (id: string) => void, selected: string | null) {
  const wanted = new Set(sites.map(site => site.id));
  for (const [id, marker] of pins) {
    if (!wanted.has(id)) { marker.remove(); pins.delete(id); }
  }
  for (const site of sites) {
    let marker = pins.get(site.id);
    if (!marker) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wtp-office-pin";
      button.dataset.officeId = site.id;
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "▤";
      button.appendChild(icon);
      button.addEventListener("click", event => { event.stopPropagation(); onSelect(site.id); });
      marker = create(button, site);
      pins.set(site.id, marker);
    }
    marker.setLngLat([site.lng, site.lat]);
    const button = marker.getElement();
    button.setAttribute("aria-label", `Office: ${site.name}`);
    button.dataset.selected = String(site.id === selected);
  }
}
