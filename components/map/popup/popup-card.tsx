"use client";

import type { ReactNode } from "react";

export { PopupRow } from "./popup-row";

export function PopupSectionLabel({ children }: { children: ReactNode }) {
  return <p className="popup-section-label">{children}</p>;
}
