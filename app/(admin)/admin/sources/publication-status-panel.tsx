import type {
  ContractPublication,
  PublicationStatusRead,
  PublicationVerdict,
} from "@/lib/civic-data/publication-status.ts";
import { When } from "../../console-ui.tsx";
import { Code, StatusBlock } from "../../status-ui.tsx";

/**
 * Published versus reader-visible, per routine contract, from narrow evidence:
 * the promotion pointer and the typed Reader readback of exactly that version
 * (`lib/civic-data/publication-status.ts`). (2026-09-23.) The proof-based
 * section below re-verifies payloads and is too large for a page request; this
 * one says what it trusts instead.
 */

const VERDICT_WORDS: Readonly<Record<PublicationVerdict, string>> = {
  READER_VISIBLE: "published and read back by the typed Reader",
  READBACK_FAILED: "published, but the typed Reader readback failed",
  PUBLISHED_NOT_READ_BACK: "published, with no readback of that version recorded",
  PUBLISHED_NO_READER_SURFACE: "published; no Reader projection (publication is the last stage)",
  NOT_PUBLISHED: "not published: no promotion pointer names the contract",
};

const EXCEPTIONS: readonly PublicationVerdict[] = ["READBACK_FAILED", "PUBLISHED_NOT_READ_BACK", "NOT_PUBLISHED"];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function Attempt({ row }: { readonly row: ContractPublication }) {
  if (row.latestAttempt === null) return <>no local attempt recorded</>;
  return (
    <>
      <Code raw={row.latestAttempt.state} /> <When iso={row.latestAttempt.attemptedAt} />
      {row.latestAttempt.failureCode !== null && <> · <Code raw={row.latestAttempt.failureCode} /></>}
    </>
  );
}

export function PublicationStatusPanel({ read }: { readonly read: PublicationStatusRead }) {
  if (read.kind !== "HELD") {
    return (
      <section aria-labelledby="publication-status-heading">
        <h2 id="publication-status-heading">Published versus reader-visible</h2>
        <StatusBlock
          what={<><Code raw={read.kind} /> — the narrow publication read did not answer.</>}
          happened={read.detail}
          next="Reload. No publication or reader-visibility count is inferred from this failure."
          needsYou={{ needed: false }}
        />
      </section>
    );
  }
  const { view } = read;
  const exceptions = view.contracts.filter((row) => EXCEPTIONS.includes(row.verdict));
  return (
    <section aria-labelledby="publication-status-heading">
      <h2 id="publication-status-heading">Published versus reader-visible</h2>
      <p className="plain">
        One row per registered routine contract. Each row names the version its promotion pointer publishes, and whether
        the typed Reader read back exactly that version. This is narrow evidence: it trusts the pointer and the readback
        event as recorded, and re-verifies no payload.
      </p>
      <p className="note">Read <When iso={read.asOf} year /> from the production data plane: pointers, latest local attempts, and readback events only.</p>
      <ul className="plain" aria-label="Contracts by publication verdict">
        {(Object.keys(VERDICT_WORDS) as PublicationVerdict[]).map((verdict) => (
          <li key={verdict}>
            <strong>{view.counts[verdict]} of {view.contracts.length}</strong> {VERDICT_WORDS[verdict]}
          </li>
        ))}
        <li>
          <strong>{view.latestAttemptFailing} of {view.contracts.length}</strong> whose latest local attempt carries a failure code
        </li>
      </ul>
      {exceptions.length > 0 && (
        <table className="src-table">
          <caption>Contracts not visible to readers ({exceptions.length})</caption>
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Verdict</th>
              <th scope="col">Published version</th>
              <th scope="col">Latest attempt</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((row) => (
              <tr key={row.contractId}>
                <th scope="row"><Code raw={safeDecode(row.contractId)} /></th>
                <td>{VERDICT_WORDS[row.verdict]}</td>
                <td>{row.published === null ? "none" : <><Code raw={row.published.versionId} /> <When iso={row.published.promotedAt} /></>}</td>
                <td><Attempt row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="src-detail">
        <summary>All {view.contracts.length} contracts</summary>
        <table className="src-table">
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Verdict</th>
              <th scope="col">Readback</th>
              <th scope="col">Latest attempt</th>
            </tr>
          </thead>
          <tbody>
            {view.contracts.map((row) => (
              <tr key={row.contractId}>
                <th scope="row"><Code raw={safeDecode(row.contractId)} /></th>
                <td>{VERDICT_WORDS[row.verdict]}</td>
                <td>{row.readback === null ? "none recorded" : <><Code raw={row.readback.status} /> <When iso={row.readback.at} /></>}</td>
                <td><Attempt row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
