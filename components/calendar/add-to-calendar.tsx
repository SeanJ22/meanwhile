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
 * The ONE add-to-calendar control, on every surface a date renders.
 *
 * **Rebuilt as a centered dialog (item 4, 2026-08-15).** It used to be an
 * absolutely-positioned menu hanging off the link — which works on a desktop
 * and clips off the right edge of a phone. The author's screenshot: Apple,
 * Google and Outlook all cut in half at 390px, because a 160px menu anchored
 * to a link that already sits near the right margin has nowhere to go. The
 * fix is not a smarter anchor. An anchored menu's position is a function of
 * where its trigger happens to be, and the trigger appears inside popups,
 * bottom sheets, modal cards and page sections — there is no width at which
 * all of those leave room. A centered dialog is a function of the VIEWPORT,
 * so it is correct everywhere by construction.
 *
 * Portaled to `<body>`, so no ancestor's `overflow: hidden` or transform can
 * clip or trap it — the popup cards and the bottom sheet both scroll inside
 * themselves, and either would have eaten it.
 *
 * Three things are deliberately unchanged: the same `.ics` data href for
 * Apple and Outlook, the same Google URL, and the same single "Add to
 * calendar" affordance. This is presentation. The event shape itself lives in
 * `lib/calendar/event-links.ts`, where M59's all-day rule for a meeting whose
 * publisher never posted a start time can be tested without rendering
 * anything.
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
            // Above every other large surface (the doors and the list
            // overlay sit at 1300): this dialog is opened FROM those, so it
            // has to be able to sit over the thing that opened it.
            className="fixed inset-0 z-[1400] flex items-center justify-center p-4"
            // The dialog is exempt from the outside-press dismissal that
            // item 1 gave the cards — a press in here must not also close
            // the popup this was opened from.
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
              {/* Cancel by tapping outside is the author's spec; this is the
                  discoverable form of the same exit, and the one a keyboard
                  can reach. */}
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
