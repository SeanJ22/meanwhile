import { isSourceAcquisitionDeadlineError, runInSourceAcquisitionDomain } from "../sources/acquisition-deadline.ts";

export const SOURCE_ACQUISITION_FAILURE_CODES = [
  "PUBLISHER_UNAVAILABLE",
  "PUBLISHER_RESPONSE_REFUSED",
  "PUBLISHER_DOCUMENT_INVALID",
] as const;

export type SourceAcquisitionFailureCode = (typeof SOURCE_ACQUISITION_FAILURE_CODES)[number];

export class SourceAcquisitionFailure extends Error {
  readonly code: SourceAcquisitionFailureCode;

  constructor(code: SourceAcquisitionFailureCode, detail: string) {
    super(detail);
    this.name = "SourceAcquisitionFailure";
    this.code = code;
  }
}

export function sourceAcquisitionFailure(
  code: SourceAcquisitionFailureCode,
  detail: string,
): SourceAcquisitionFailure {
  return new SourceAcquisitionFailure(code, detail);
}

export function isSourceAcquisitionFailure(error: unknown): error is SourceAcquisitionFailure {
  return error instanceof SourceAcquisitionFailure &&
    (SOURCE_ACQUISITION_FAILURE_CODES as readonly string[]).includes(error.code);
}

function errorKind(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") return error.name;
  return typeof error;
}

/** Wrap only the actual fetch call, never a larger acquisition/program block. */
export async function requestPublisher<T>(
  sourceLabel: string,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (isSourceAcquisitionFailure(error)) throw error;
    throw sourceAcquisitionFailure(
      "PUBLISHER_UNAVAILABLE",
      `${sourceLabel}: the publisher request did not complete (${errorKind(error)}).`,
    );
  }
}

export async function readPublisherBody<T>(
  sourceLabel: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isSourceAcquisitionFailure(error)) throw error;
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `${sourceLabel}: the publisher response body could not be read (${errorKind(error)}).`,
    );
  }
}

/** On timeout the promise settles only after the abort-aware operation itself has settled. */
export async function withPublisherAcquisitionDeadline<T>(
  sourceLabel: string,
  timeoutMs: number,
  acquisition: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  try {
    return await runInSourceAcquisitionDomain(
      { sourceLabel, timeoutMs },
      acquisition,
    );
  } catch (error) {
    if (isSourceAcquisitionFailure(error)) throw error;
    if (!isSourceAcquisitionDeadlineError(error)) throw error;
    throw sourceAcquisitionFailure(
      "PUBLISHER_UNAVAILABLE",
      `${sourceLabel}: the publisher acquisition exceeded its ${timeoutMs}ms deadline.`,
    );
  }
}
