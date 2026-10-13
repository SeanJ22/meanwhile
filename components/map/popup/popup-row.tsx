"use client";

import { Children, Fragment, isValidElement, type ReactNode } from "react";

function hasValue(value: ReactNode): boolean {
  return Children.toArray(value).some(child => {
    if (typeof child === "string") return child.trim().length > 0;
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) return hasValue(child.props.children);
    return true;
  });
}

/** Key/value content is independent of the legacy popup frame and its CSS. */
export function PopupRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  if (!hasValue(children)) return null;
  return <div className="popup-row"><span className="pk">{label}</span><span className={mono ? "pv mono" : "pv"}>{children}</span></div>;
}
