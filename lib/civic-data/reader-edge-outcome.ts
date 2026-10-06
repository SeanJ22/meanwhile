export interface ReaderEdgePublicationOutcome {
  readonly ok: boolean;
  readonly readerEdge: string;
  readonly store: "local folder" | "Netlify Blobs" | "not configured";
  readonly sequence: number | null;
  /** Omitted when this pass carried the earlier meeting artifacts without reading them. */
  readonly supersededMeetingFields?: number;
  readonly detail: string | null;
}

