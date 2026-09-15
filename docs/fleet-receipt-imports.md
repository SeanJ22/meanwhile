# Historical receipt import boundary

The receipt file loader now reads its frozen wire contract, schema validator,
directory constant and summary projection from
`lib/control-plane/promotion/historical-receipt.ts`. The leaf has no imports,
including type imports. Loading an archived receipt no longer imports the retiring
promoter, window implementation, Reader projection or source data through that
promoter. These historical shapes do not define the permanent civic data plane.

## Measured executable closure

The baseline was captured before edits at
`d685fc4afd48ce157d37d4e77987a120ffcbb263`. Both measurements use the same
`esbuild` options: the receipt-store entry, `bundle: true`, `write: false`,
`metafile: true`, `platform: "node"`, `packages: "external"`, and the default
CommonJS output format. Neither measurement executes the bundled application.

| Measurement | Before extraction | After extraction |
| --- | ---: | ---: |
| Executable source inputs | 44 | 3 |
| Total input source bytes | 949,647 | 49,372 |
| Emitted bundle bytes | 198,898 | 15,104 |

The three remaining inputs are the loader, the historical leaf, and
`repository/types.ts` for its existing canonical JSON function. External runtime
imports are Node built-ins only. These numbers measure this entry's local bundle
closure; they are not startup-time, request-latency, deployment-size or production
performance measurements. Other Admin modules have their own dependencies.

Raw evidence: `docs/fleet-receipt-imports-baseline.json` contains the original
metafile inputs and imports. `docs/fleet-receipt-imports-after.json` contains the
post-extraction inputs, imports and SHA-256 hashes of the measured source files.
The latter describes the local extraction over the pinned base, not a deployed
commit or a production observation.

## Focused controls and limits

`tests/fleet-receipt-imports.test.ts` verifies:

- The executable loader bundle contains only the three permitted source modules.
- The historical leaf has zero imports or re-exports, including type-only edges.
- That leaf alone passes strict TypeScript checking against standard ES2022 types.
- A temporary copy containing only the loader, leaf and repository contract can
  bundle and execute the archive reader with the producer, window module, current
  promotion types and all source data physically absent. A historical refusal is
  loaded; malformed replacement JSON preserves it with its original successful
  read timestamp and a named retained-evidence gap. No repo files are deleted.

The copied-loader control proves the **executable, type-erased** boundary. It does
not prove final PDC TypeScript compatibility. The loader intentionally still uses
the type-only `WindowRunRecord.promotionReceipts` member; replacing that window
integration remains pending for the final combined head. The independent leaf typecheck establishes
only that the retained historical contract itself survives removal of those types.

No repository-wide typecheck, build, broad certification, production access or
deployment is part of these import-boundary controls. Existing actual-producer
receipt and Admin-consumer tests remain the behavioral compatibility controls.

The four import controls passed; the actual run is retained in
[fleet-historical-receipt-imports.tap](evidence/fleet-historical-receipt-imports.tap).
