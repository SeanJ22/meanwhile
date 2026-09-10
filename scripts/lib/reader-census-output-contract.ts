import type {
  ReaderClosureExecutionAuthorityReference,
  ReaderClosureReceipt,
  ReaderSourceHash,
} from "../../lib/holdings/reader-census.ts";

const READER_EVIDENCE_JSON = /^docs\/evidence\/reader-last-mile-[a-z0-9-]+\.json$/;
const READER_RUNTIME_JSON = /^\.runtime\/reader-last-mile-[a-z0-9-]+\.json$/;

const OUTPUT_FLAGS = {
  activePortraits: "--active-portraits-output",
  renderedComponents: "--render-components-output",
  bundle: "--bundle-output",
  bundleDescriptor: "--bundle-descriptor-output",
  proofSources: "--proof-sources-output",
} as const;

export interface ReaderCensusOutputPaths {
  readonly activePortraits: string;
  readonly renderedComponents: string;
  readonly bundle: string;
  readonly bundleDescriptor: string;
  readonly proofSources?: string;
}

function explicitOutput(
  args: readonly string[],
  flag: string,
): { readonly explicit: boolean; readonly path?: string } {
  const indexes = args.flatMap((argument, index) => argument === flag ? [index] : []);
  if (indexes.length > 1) throw new Error(`${flag} may be passed at most once`);
  if (indexes.length === 0) return { explicit: false };
  const path = args[indexes[0]! + 1];
  if (!path || path.startsWith("--")) throw new Error(`${flag} requires an explicit path`);
  if (!READER_EVIDENCE_JSON.test(path)) {
    throw new Error(`${flag} must stay inside the immutable Reader evidence namespace`);
  }
  return { explicit: true, path };
}

function explicitRuntimeOutput(
  args: readonly string[],
  flag: string,
): { readonly explicit: boolean; readonly path?: string } {
  const indexes = args.flatMap((argument, index) => argument === flag ? [index] : []);
  if (indexes.length > 1) throw new Error(`${flag} may be passed at most once`);
  if (indexes.length === 0) return { explicit: false };
  const path = args[indexes[0]! + 1];
  if (!path || path.startsWith("--")) throw new Error(`${flag} requires an explicit path`);
  if (!READER_RUNTIME_JSON.test(path)) {
    throw new Error(`${flag} must be a scoped ignored Reader runtime JSON path`);
  }
  return { explicit: true, path };
}

/**
 * Resolve every census side output before any evidence is written. Explicit
 * destinations are admitted only when their producing mode is active, paired
 * bundle outputs move together, and no output may overwrite another artifact.
 */
export function readerCensusOutputPaths(
  args: readonly string[],
  censusOutput: string,
): ReaderCensusOutputPaths {
  const activePortraits = explicitOutput(args, OUTPUT_FLAGS.activePortraits);
  const renderedComponents = explicitOutput(args, OUTPUT_FLAGS.renderedComponents);
  const bundle = explicitOutput(args, OUTPUT_FLAGS.bundle);
  const bundleDescriptor = explicitOutput(args, OUTPUT_FLAGS.bundleDescriptor);
  const proofSources = explicitRuntimeOutput(args, OUTPUT_FLAGS.proofSources);

  const projectionOption = args.indexOf("--projection");
  const projectionRequested = args.includes("--project") || (
    projectionOption >= 0 &&
    Boolean(args[projectionOption + 1]) &&
    !args[projectionOption + 1]!.startsWith("--")
  );
  if (activePortraits.explicit && (!projectionRequested || args.includes("--check"))) {
    throw new Error(`${OUTPUT_FLAGS.activePortraits} requires a writing projection run`);
  }
  if (proofSources.explicit && (!projectionRequested || args.includes("--check"))) {
    throw new Error(`${OUTPUT_FLAGS.proofSources} requires a writing projection run`);
  }
  if (renderedComponents.explicit && !args.includes("--render-components")) {
    throw new Error(`${OUTPUT_FLAGS.renderedComponents} requires --render-components`);
  }
  const bundleRequested = args.includes("--build-receipt");
  if ((bundle.explicit || bundleDescriptor.explicit) && !bundleRequested) {
    throw new Error("Explicit bundle outputs require --build-receipt");
  }
  if (bundle.explicit !== bundleDescriptor.explicit) {
    throw new Error("--bundle-output and --bundle-descriptor-output must be passed together");
  }

  const resolved: ReaderCensusOutputPaths = {
    activePortraits: activePortraits.path ?? "docs/evidence/reader-last-mile-active-portraits.json",
    renderedComponents: renderedComponents.path ?? censusOutput.replace(/\.json$/, "-components.json"),
    bundle: bundle.path ?? "docs/evidence/reader-last-mile-bundle.json",
    bundleDescriptor: bundleDescriptor.path ?? "docs/evidence/reader-last-mile-bundle-descriptor.json",
    ...(proofSources.path ? { proofSources: proofSources.path } : {}),
  };
  const producedPaths = [
    ...(projectionRequested && !args.includes("--check") ? [resolved.activePortraits] : []),
    ...(resolved.proofSources ? [resolved.proofSources] : []),
    ...(args.includes("--render-components") ? [resolved.renderedComponents] : []),
    ...(bundleRequested ? [resolved.bundle, resolved.bundleDescriptor] : []),
  ];
  if (new Set(producedPaths).size !== producedPaths.length) {
    throw new Error("Reader census side outputs must name distinct artifacts");
  }
  const censusArtifacts = new Set([
    censusOutput,
    censusOutput.replace(/\.json$/, "-projection.json"),
    censusOutput.replace(/\.json$/, "-instrument-inventory.json"),
    censusOutput.replace(/\.json$/, "-route-proof-composition.json"),
    censusOutput.replace(/\.json$/, "-component-proof-composition.json"),
    censusOutput.replace(/\.json$/, "-summary.json"),
    censusOutput.replace(/\.json$/, "-receipt.json"),
  ]);
  if (producedPaths.some((path) => censusArtifacts.has(path))) {
    throw new Error("Reader census side output cannot overwrite a census artifact");
  }
  return resolved;
}

export interface FreshReaderClosureReceiptInput {
  readonly censusPath: string;
  readonly censusSha256: string;
  readonly holdingsDigest: string;
  readonly registrySha256: string;
  readonly sourceHashes: readonly ReaderSourceHash[];
  readonly evidenceHashes: readonly ReaderSourceHash[];
  readonly executionAuthority?: ReaderClosureExecutionAuthorityReference;
}

/** Fresh execution is intentionally not an inheritance mode. */
export function freshReaderClosureReceipt(
  input: FreshReaderClosureReceiptInput,
): ReaderClosureReceipt {
  if (Object.hasOwn(input, "inheritance")) {
    throw new Error("Fresh Reader closure cannot carry inheritance");
  }
  return {
    formatVersion: 1,
    censusPath: input.censusPath,
    censusSha256: input.censusSha256,
    holdingsDigest: input.holdingsDigest,
    registrySha256: input.registrySha256,
    sourceHashes: input.sourceHashes,
    evidenceHashes: input.evidenceHashes,
    ...(input.executionAuthority ? { executionAuthority: input.executionAuthority } : {}),
  };
}
