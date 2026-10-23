import type { VotingExtraction } from "../../ballot/voting-source-types.ts";
import type { LocalElectionOffice, LocalElectionOfficeField } from "./model.ts";

export type LocalElectionOfficeIdentity = Pick<LocalElectionOffice, "id" | "state" | "divisionId" | "countyFips" | "countyName" | "town" | "municipalityType" | "countySubdivisionGeoid" | "excludedMunicipalities">;
export type LocalElectionOfficeColumn = LocalElectionOfficeField | "countyName" | "town" | "municipalityType" | "countyFips" | "countySubdivisionGeoid" | "divisionId";
export interface LocalElectionOfficeFieldExtraction {
  /** Named table column(s), or a zero-based column number written as text. */
  readonly column?: string | readonly string[];
  /** Source-block capture, before HTML transcription. */
  readonly pattern?: string;
  readonly group?: number;
  /** A literal value must still appear in the saved source; it is never evidence by itself. */
  readonly literal?: string;
  /** A directory heading naming the office shared by its rows, e.g. County Clerk. */
  readonly documentHeading?: boolean;
  /** Public publisher-side email encoding, decoded by its own XOR representation. */
  readonly encoding?: "cloudflare-email";
  /** Match the visible source transcription instead of HTML tags. */
  readonly text?: boolean;
}
export interface LocalElectionOfficeRoute {
  readonly id: string;
  readonly state: string;
  readonly url: string;
  readonly publisher: string;
  readonly directoryUrl: string;
  readonly format: "html" | "text" | "csv" | "tsv" | "xlsx" | "pdf" | "json";
  /** Public directory form parameters only; no reader address, cookies or credentials. */
  readonly request?: { readonly method: "POST"; readonly body: string; readonly contentType?: string };
  /** A local office page supplies fields for one exact, directory-established identity. */
  readonly scope?: LocalElectionOfficeIdentity;
  /** Exact source jurisdiction text on a single-office page. */
  readonly jurisdictionQuote?: string;
  readonly extraction: {
    readonly tableIndex?: number;
    readonly table?: Pick<VotingExtraction, "headers" | "headerRow" | "delimiter" | "sheet" | "pdfColumns" | "pdfRecordStart" | "pdfCenteredRecords" | "pdfBlocks" | "pdfTop" | "pdfBottom">;
    /** Regex blocks for directories whose contacts are cards instead of tables. */
    readonly records?: { readonly pattern: string; readonly group?: number };
    /** A JSON array path, with dots between literal keys. */
    readonly jsonPath?: string;
    /** A public page's inline JSON value, when the page carries the directory. Capture group 1 is parsed. */
    readonly jsonPattern?: string;
    /** The office's own published business-hours section, re-extracted on every run. */
    readonly officeHours?: boolean;
    readonly fields: Partial<Readonly<Record<LocalElectionOfficeColumn, LocalElectionOfficeFieldExtraction>>>;
  };
  /** Scope joins are captured from the jurisdiction reference, never guessed from similar names. */
  readonly identities?: Readonly<Record<string, LocalElectionOfficeIdentity>>;
}

/** The directory's own printed county/town labels select its exact identity. */
export function localElectionOfficeIdentityKey(row: Partial<Record<LocalElectionOfficeColumn, string>>): string {
  return [row.countyName ?? "", row.municipalityType ?? "", row.town ?? ""].map(part => part.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}
