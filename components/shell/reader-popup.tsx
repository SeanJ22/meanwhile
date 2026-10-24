"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { ReaderPop } from "./pill-cluster";

/**
 * A small popup anchored to its control (ZIP, Where can I vote?, Ask). At most
 * one is open. Placement is CSS (`.mw-pop`). A press outside it, other than on
 * its own control, the sidebar or the header, dismisses it.
 */
export function ReaderPopup({
  pop,
  anchor,
  title,
  onClose,
  children,
}: {
  pop: Exclude<ReaderPop, null>;
  /** Where the control that opened it lives. */
  anchor: "sidebar" | "header";
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || ref.current?.contains(target)) return;
      // Its own control toggles it; let that click do the closing.
      if (target.closest(".mw-nav-wrap, .wtp-vote-pin")) return;
      // A press on the map, the sidebar or the header is using the app, not
      // dismissing a form mid-typing — except the map, which is "outside".
      if (target.closest(".sidebar, .mw-header")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="mw-pop"
      data-pop={pop}
      data-anchor={anchor}
      role="dialog"
      aria-label={title}
    >
      <div className="mw-pop-head">
        <span className="mw-pop-title">{title}</span>
        <button
          type="button"
          className="mw-pop-close"
          aria-label="Close"
          onClick={onClose}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {children}
    </div>
  );
}
