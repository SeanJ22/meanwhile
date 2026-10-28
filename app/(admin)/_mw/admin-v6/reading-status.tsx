"use client";

import type { Ref } from "react";
import { PULSE_STALE_MS } from "@/lib/control-plane/live-pulse.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import type { Reading } from "./use-reading.ts";
import s from "./v6.module.css";

export function ReadingStatus({ ref, reading, label, active, now }: {
  readonly ref: Ref<HTMLParagraphElement>;
  readonly reading: Reading<unknown>;
  readonly label?: string;
  readonly active: boolean;
  readonly now: number;
}) {
  const stale = reading.kind === "ready" && (reading.stale || now - Date.parse(reading.at) > PULSE_STALE_MS);
  return <p ref={ref} className={s.meta} role="status">
    {label && `${label} · `}{reading.kind === "ready"
      ? <>Last loaded <time dateTime={reading.at}>{formatEastern(reading.at)}</time>{stale ? " · Stale" : ""}</>
      : reading.kind === "failed" ? "Could not load this panel" : "Not loaded yet"}
    {!active && " · Updates paused"}
  </p>;
}
