"use client";

import { databaseReadingSentence, type DatabaseReadingView } from "@/lib/control-plane/admin-view/database-reading.ts";

import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

/** One line on Now: yesterday's and today's database reading against the daily target. */
export function DatabaseReadingLine() {
  const { reading, status } = useReading<DatabaseReadingView>("/api/admin/v6/database-reading");
  return (
    <section aria-label="Database reading">
      {status}
      <p className={s.small}>
        {reading.kind === "ready" ? databaseReadingSentence(reading.data)
          : reading.kind === "failed" ? "Database reading could not be read just now." : "Reading today's database use…"}
      </p>
    </section>
  );
}
