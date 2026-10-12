"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  googleCalendarUrl,
  icsDataHref,
  icsFileName,
  type CalendarEventInput,
} from "@/lib/calendar/event-links";

import {
  AppleCalendarMark,
  GoogleCalendarMark,
  OutlookCalendarMark,
} from "./calendar-marks";

/**
 * The one add-to-calendar control. A centered dialog portaled to `<body>`, so
 * no trigger position or ancestor overflow can clip it. The event shape lives
 * in `lib/calendar/event-links.ts`.
 */
export function AddToCalendar({
  event,
  className,
}: {
  event: CalendarEventInput;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const ics = icsDataHref(event);
  const file = icsFileName(event);

  return (
    <span className={`inline-block ${className ?? ""}`}>
      <button
        type="button"
        data-add-to-calendar
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="cursor-pointer t-detail text-link underline decoration-dotted hover:no-underline"
      >
        Add to calendar
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add to calendar"
            // Above the doors and list overlay (z 1300), which open this dialog.
            className="fixed inset-0 z-[1400] flex items-center justify-center p-4"
            // A press in here must not also close the popup this was opened from.
            data-dismiss-exempt
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-black/45 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <div className="panel calendar-chooser relative w-full max-w-xs p-5">
              <p className="t-heading font-semibold leading-snug text-paper">
                Add to which calendar?
              </p>
              {event.endEstimated && (
                <p className="mt-1.5 t-detail leading-relaxed text-paper-dim" data-end-estimated>
                  The end time was not published, so the entry blocks 90
                  minutes as a placeholder and says so in its notes.
                </p>
              )}
              <div className="mt-3.5 flex flex-col gap-2">
                <a
                  href={ics}
                  download={file}
                  onClick={() => setOpen(false)}
                  className="calendar-choice"
                >
                  <AppleCalendarMark />
                  <span>Apple Calendar</span>
                </a>
                <a
                  href={googleCalendarUrl(event)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className="calendar-choice"
                >
                  <GoogleCalendarMark />
                  <span>Google Calendar</span>
                </a>
                <a
                  href={ics}
                  download={file}
                  onClick={() => setOpen(false)}
                  className="calendar-choice"
                >
                  <OutlookCalendarMark />
                  <span>Outlook</span>
                </a>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setOpen(false)}
                className="mt-3.5 w-full cursor-pointer rounded-md border border-[var(--panel-border)] px-4 py-2 t-body font-semibold text-paper transition-colors hover:border-paper"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
