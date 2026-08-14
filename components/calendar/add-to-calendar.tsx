"use client";

import { useEffect, useRef, useState } from "react";

import {
  googleCalendarUrl,
  icsDataHref,
  icsFileName,
  type CalendarEventInput,
} from "@/lib/calendar/event-links";

/**
 * The ONE add-to-calendar control (session item 4, wall clock 2026-08-14
 * second session). A single "Add to calendar" link; tapping it opens a
 * small popup offering Apple Calendar, Google Calendar, and Outlook.
 * Apple and Outlook both consume the same .ics file — only Google
 * differs, so this is presentation, not new plumbing. Replaces the
 * previous two-link render ("Add to calendar (.ics) · Google Calendar")
 * on every surface a date renders.
 */
export function AddToCalendar({
  event,
  className,
}: {
  event: CalendarEventInput;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ics = icsDataHref(event);
  const file = icsFileName(event);

  return (
    <span ref={rootRef} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="cursor-pointer text-[0.75rem] text-signal underline decoration-dotted hover:no-underline"
      >
        Add to calendar
      </button>
      {open && (
        <span
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 flex w-40 flex-col rounded border border-[var(--panel-border)] bg-[var(--panel-bg,var(--bg))] p-1 shadow-lg"
        >
          <a
            role="menuitem"
            href={ics}
            download={file}
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1 text-[0.75rem] text-paper hover:bg-[var(--surface,rgba(255,255,255,0.06))]"
          >
            Apple Calendar
          </a>
          <a
            role="menuitem"
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1 text-[0.75rem] text-paper hover:bg-[var(--surface,rgba(255,255,255,0.06))]"
          >
            Google Calendar
          </a>
          <a
            role="menuitem"
            href={ics}
            download={file}
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1 text-[0.75rem] text-paper hover:bg-[var(--surface,rgba(255,255,255,0.06))]"
          >
            Outlook
          </a>
        </span>
      )}
    </span>
  );
}
