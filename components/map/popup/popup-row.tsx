"use client";

import type { ReactNode } from "react";
import { WorkingOnIt } from "@/components/demand/working-on-it";

/** Key/value content is independent of the legacy popup frame and its CSS. */
export function PopupRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className="popup-row"><span className="pk">{label}</span><span className={mono ? "pv mono" : "pv"}>{children}</span></div>;
}
export function NoValue(_props: { children?: ReactNode }) {
  return <WorkingOnIt inline />;
}
