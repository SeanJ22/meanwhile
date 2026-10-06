"use client";

import { WorkingOnIt } from "@/components/demand/working-on-it";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { resolveZipAsync, warmZctaTable } from "@/lib/geo/zcta-table";

import { ZipComb } from "./zip-comb";

/**
 * The persisted zip, and the way out of it.
 *
 * A returning reader skips the entry notice, which is only fair if changing the
 * zip is one visible click away rather than a cleared cache.
 */

const MESSAGES = {
  malformed: "Five digits.",
  unknown: "No such zip code.",
  uncovered: "__coverage_gap__",
} as const;

interface LocationBarProps {
  zip: string;
  meetingCount: number;
  onChange: (zip: string, lat: number, lng: number) => void;
}

export function LocationBar({ zip, meetingCount, onChange }: LocationBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setEditing(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  // P-002 · the table arrives while the reader is typing, not before paint.
  useEffect(() => {
    if (editing) warmZctaTable();
  }, [editing]);

  async function submit() {
    const result = await resolveZipAsync(draft);
    if (!result.ok) {
      setError(MESSAGES[result.reason]);
      return;
    }

    onChange(result.centroid.zip, result.centroid.lat, result.centroid.lng);
    setEditing(false);
    setDraft("");
    setError(null);
  }

  if (!editing) {
    return (
      <div className="panel pointer-events-auto flex items-stretch">
        <div className="px-4 py-2.5">
          <p className="font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] text-muted">
            Showing
          </p>
          <p className="mt-0.5 font-mono t-title leading-none tabular-nums text-paper">
            {zip}
          </p>
        </div>

        {/* ITEM 1d (2026-08-17): an explicit hook. This chip, the sidebar
            counter and the meetings panel all state the same number, and the
            permanent walk check asserts they agree — it must not have to find
            them by matching visible label text, which is copy and moves. */}
        <div
          data-meeting-count={meetingCount}
          className="hidden border-l border-rule-soft px-4 py-2.5 sm:block"
        >
          <p className="font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] text-muted">
            Meetings
          </p>
          <p className="mt-0.5 font-mono t-title leading-none tabular-nums text-paper">
            {meetingCount}
          </p>
        </div>

        <button
          onClick={() => {
            setDraft("");
            setError(null);
            setEditing(true);
          }}
          className="trailing-space-trimmed-16 border-l border-rule-soft px-4 font-mono t-caption uppercase tracking-[0.16em] text-paper-dim transition-colors hover:bg-ink-raised hover:text-signal"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="panel pointer-events-auto w-[19rem] p-4">
      <p className="trailing-space-trimmed-18 mb-2.5 font-mono t-caption uppercase tracking-[0.18em] text-muted">
        New zip code
      </p>

      <ZipComb
        value={draft}
        onChange={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        onSubmit={() => void submit()}
        invalid={Boolean(error)}
        describedBy={error ? "location-bar-error" : undefined}
        autoFocus
      />

      {error && (
        <p id="location-bar-error" role="alert" className="mt-2 t-body text-signal">
          {error === MESSAGES.uncovered ? <WorkingOnIt inline /> : error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button onClick={() => void submit()} size="sm" disabled={draft.length !== 5} className="flex-1">
          Show meetings
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
