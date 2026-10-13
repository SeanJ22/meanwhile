export type AddressBallotStatus = "HELD" | "NOT_RECORDED" | "HOLDING_UNAVAILABLE";

/** A registered source's store answered without a published ballot projection. */
export class MissingBallotProjectionError extends Error {
  constructor(source: string) {
    super(`${source} has no published ballot projection.`);
    this.name = "MissingBallotProjectionError";
  }
}
