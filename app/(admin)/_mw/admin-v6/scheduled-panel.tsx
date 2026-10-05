"use client";

/** **SCHEDULED ORDERS — a panel on Work (BR-15).** Each order waiting to be sent, with when. Shown only when there are some. */
import type { ScheduledView } from "@/lib/control-plane/admin-view/v6-scheduled-read.ts";

import { Card, cx, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function ScheduledPanel() {
  const { reading } = useReading<ScheduledView>("/api/admin/v6/scheduled", 60_000);
  const data = reading.kind === "ready" ? reading.data : null;
  if (!data || !data.rows.length) return null;
  return (
    <Card title="Scheduled orders" id="scheduled">
      <div className={s.stack}>
        {data.rows.map((r, n) => (
          <div key={`${r.label}-${n}`} className={s.row}>
            <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.label}</strong><Pill tone="neutral">{r.status}</Pill></span>
            <span className={cx(s.p, s.meta)}>{r.when}{r.repeats ? ` · ${r.repeats}` : ""}{r.finishBy ? ` · finish by ${r.finishBy}` : ""}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
