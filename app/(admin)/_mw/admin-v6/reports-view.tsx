"use client";

/**
 * **REPORTS — what readers said was wrong, from the live site and the tester
 * site.** Newest first, each labeled by the site it came from. Every row says
 * what the reader reported (the card), the ZIP they were looking at and the
 * record id, so the fix can start from the record. Reports are read only here:
 * there is no delete.
 */
import type { ReportRow, ReportsReading, SiteReports } from "@/lib/control-plane/reports/read-reports.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Failed, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

const SITE_WORDS = { live: "Live site", tester: "Tester site" } as const;

function Row({ row }: { readonly row: ReportRow }) {
  return (
    <li>
      <p className={s.p}>{row.message}</p>
      <p className={cx(s.meta)}>
        {mst(row.receivedAt)} · {SITE_WORDS[row.site]} · {row.origin}
        {row.about ? ` · about: ${row.about}` : " · card not recorded"}
        {row.zip ? ` · ZIP ${row.zip}` : ""}
        {row.recordId ? ` · record ${row.recordId}` : ""}
        {row.hasReplyAddress ? " · left a reply address" : ""}
        {row.suspectReason ? ` · held as suspect: ${row.suspectReason}` : ""}
      </p>
    </li>
  );
}

function Site({ result }: { readonly result: SiteReports }) {
  const title = SITE_WORDS[result.site];
  if (result.kind === "UNREADABLE") {
    return (
      <Card title={title} tone="warn">
        <p className={s.p}>{result.says}</p>
        <p className={cx(s.p, s.meta)}>Nothing here means this site could not be read, not that no one reported anything.</p>
      </Card>
    );
  }
  return (
    <Card title={<>{title} <span className={s.meta}>({result.total} {result.total === 1 ? "report" : "reports"})</span></>} aside={<Pill tone="neutral">Read only</Pill>}>
      {result.rows.length === 0 ? <Empty>No one has reported a problem on this site.</Empty> : <ul>{result.rows.map((row) => <Row key={`${row.site}-${row.id}`} row={row} />)}</ul>}
      {result.total > result.rows.length && <p className={cx(s.p, s.meta)}>Showing the newest {result.rows.length} of {result.total}.</p>}
    </Card>
  );
}

export function ReportsView() {
  const { reading, reload } = useReading<ReportsReading>("/api/admin/reports");
  return (
    <>
      <header>
        <p className={s.eyebrow}>From “Report a problem”</p>
        <h1 className={s.h1}>Reports</h1>
        <p className={cx(s.p, s.small, s.dim)}>What readers said was wrong, newest first, from the live site and the tester site.</p>
      </header>
      {reading.kind === "loading" && <Loading what="the reports" />}
      {reading.kind === "failed" && <Failed what="The reports" retry={reload} />}
      {reading.kind === "ready" && (
        <>
          <p className={cx(s.p, s.meta)}>Read {mst(reading.data.observedAt)}.{reading.stale ? " The latest refresh failed, so this is the last good reading." : ""}</p>
          {reading.data.sites.map((result) => <Site key={result.site} result={result} />)}
        </>
      )}
    </>
  );
}
