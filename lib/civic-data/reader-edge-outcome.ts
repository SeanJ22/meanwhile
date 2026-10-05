export interface ReaderEdgePublicationOutcome {
  readonly ok: boolean;
  readonly readerEdge: string;
  readonly store: "local folder" | "Netlify Blobs" | "not configured";
  readonly sequence: number | null;
  readonly detail: string | null;
}

