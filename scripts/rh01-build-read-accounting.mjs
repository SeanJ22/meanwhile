/** Canonical build preload: record production HTTP bodies, refuse API writes/model calls, preserve local lifecycle shells. */
import { enableProductionReadAccounting } from "./rh01-network.mjs";

process.env.WTP_VITAL_SIGNS_REPORT ??= "1";
enableProductionReadAccounting("canonical-build", { subprocess: false, retryReadSql: false });
