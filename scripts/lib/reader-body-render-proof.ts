import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { sha256, inspectReaderMarkup, readReaderEvidence, type ReaderCensus, type CensusRecord, type ReaderComponentCase } from "../../lib/holdings/reader-census.ts";
import { loadManifestContext } from "../../lib/holdings/manifest.ts";
import type { Registry } from "../../lib/registry/types.ts";
import type { CoveredBody } from "../../lib/registry/coverage.ts";
import type { ModalSubject, BodyDefinitionText } from "../../components/map/popup/entity-modal.tsx";
import type { SeatHolder } from "../../lib/officials/lookup.ts";
import type { DistrictHit } from "../../lib/map/districts.ts";
import type { ComponentType, ReactNode } from "react";
import type { ShellData } from "../../lib/state/data.tsx";
import type { Meeting } from "../../lib/sources/types.ts";
import { readSnapshot } from "../../lib/meetings/snapshot.ts";
import { meetingListingIdentity } from "../../lib/meetings/listing-identity.ts";
import { canonicalBodyIdentity } from "../../lib/ask/body-identity.ts";
import { groupByVenue } from "../../lib/meetings/venues.ts";
import { membersOfBody } from "../../lib/registry/body-membership.ts";
import { rosterGapForBody, type RosterReaderGap } from "../../lib/registry/body-rosters.ts";
import { jurisdictionClaim, representationNoteForClaim } from "../../lib/meetings/jurisdiction-badge.ts";
import { TIER_LABEL } from "../../lib/ocd/tiers.ts";
import { districtCardSources } from "../../lib/officials/card-sources.ts";
import { definitionsForBody } from "../../lib/officials/body-definitions.ts";
import { bodyClassLong } from "../../lib/registry/body-class-labels.ts";
import { seatHoldersForDivision } from "../../lib/registry/server.ts";
import { DISTRICT_LAYERS } from "../../lib/map/districts.ts";
import { readerOfficeTitle } from "../../lib/officials/reader-office-title.ts";
import { runsSomething, topOfficesFor } from "../../lib/officials/top-offices.ts";

/** Actual product leaves, compiled in memory. This makes no in-situ or build claim. */
export async function bodyRenderProof(root = process.cwd()) {
  const moduleApi = await import("node:module") as unknown as { registerHooks: (hooks: { resolve: (specifier: string, context: { parentURL?: string }, next: (specifier: string, context: unknown) => unknown) => unknown; load: (url: string, context: unknown, next: (url: string, context: unknown) => unknown) => unknown }) => { deregister: () => void } };
  const entityPath = "components/map/popup/entity-modal.tsx";
  const districtPath = "components/map/popup/district-popup.tsx";
  const selectorPath = "components/map/map-entry.tsx";
  moduleApi.registerHooks({
    resolve(specifier, context, next) {
      const base = specifier.startsWith("@/") ? join(root, specifier.slice(2)) : specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
      if (base && !base.replaceAll("\\", "/").includes("/node_modules/")) for (const suffix of ["", ".ts", ".tsx"]) if (existsSync(`${base}${suffix}`)) return next(pathToFileURL(`${base}${suffix}`).href, context);
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.endsWith(".tsx")) return next(url, context);
      // Export the existing private leaves, with their original bodies unchanged.
      // Collapsed CardSection intentionally does not SSR its children; this proves
      // those actual children independently and labels that scope explicitly.
      const productSource = readFileSync(fileURLToPath(url), "utf8");
      const privateLeaves = ["DefinitionBlock", "Representation"].filter((name) => !new RegExp(`export function ${name}\\b`).test(productSource));
      const leafExports = fileURLToPath(url).replaceAll("\\", "/").endsWith(entityPath) && privateLeaves.length ? `\nexport { ${privateLeaves.join(", ")} };\n` : "";
      const source = ts.transpileModule(productSource + leafExports, { fileName: fileURLToPath(url), compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      return { format: "module", source, shortCircuit: true };
    },
  });
  const [{ createElement, Fragment }, { renderToStaticMarkup }, entityModule, { DistrictPopup }] = await Promise.all([import("react"), import("react-dom/server"), import("../../components/map/popup/entity-modal.tsx"), import("../../components/map/popup/district-popup.tsx")]);
  const { EntityModal, DefinitionBlock, Representation } = entityModule as typeof entityModule & { DefinitionBlock: ComponentType<{ definition: BodyDefinitionText }>; Representation: ComponentType<{ holders: SeatHolder[]; note: string; gaps?: readonly RosterReaderGap[] }> };
  const { schoolDependency } = await import("../../lib/officials/school-dependency.ts");
  const { CardSourcesList } = await import("../../components/officials/card-sources-list.tsx");
  const { DataProvider } = await import("../../lib/state/data.tsx");
  const snapshot = readSnapshot();
  if (!snapshot) throw new Error("The canonical meeting snapshot is required for the actual product provider");
  const canonicalMeetings = snapshot.meetings;
  const listingIdentity = meetingListingIdentity(snapshot.meetings, canonicalBodyIdentity);
  // This proves an exact body's record view, not residence or geographical
  // applicability. No address, point, drawn district or governing set is invented.
  const providerValue: ShellData = {
    allMeetings: snapshot.meetings, meetings: snapshot.meetings, listingIdentity,
    venues: groupByVenue(snapshot.meetings, listingIdentity), result: null, location: null,
    drawnDistricts: [], dropped: 0, searchFailed: false, atAddress: false,
    governing: null, zipPartial: null, basis: "ZIP",
  };
  const renderProduct = (children: ReactNode) => renderToStaticMarkup(createElement(DataProvider, { value: providerValue, children }));
  // Use the exact product selector AST, not a second implementation. Dependencies
  // are the same canonical modules imported by map-entry; no UI state is mocked.
  const selectorSource = readFileSync(join(root, selectorPath), "utf8");
  const ast = ts.createSourceFile(selectorPath, selectorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["bodySubject", "bodyContactRows", "BODY_TYPE_LABEL"];
  const nodes = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""));
  if (nodes.length !== names.length) throw new Error("Canonical body selector functions changed; review the proof adapter.");
  const extracted = nodes.map((node) => node.getText(ast)).join("\n");
  const javascript = ts.transpileModule(extracted, { compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: "createElement", target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const dependencies = { createElement, membersOfBody, rosterGapForBody, jurisdictionClaim, representationNoteForClaim, TIER_LABEL, districtCardSources, definitionsForBody, schoolDependency, bodyClassLong };
  const bodySubject = new Function(...Object.keys(dependencies), `${javascript}\nreturn bodySubject;`)(...Object.values(dependencies)) as (body: CoveredBody, meetings: Meeting[]) => ModalSubject;
  const census = JSON.parse(readReaderEvidence(root, "docs/evidence/reader-last-mile-current.json").toString("utf8")) as ReaderCensus;
  const registry = JSON.parse(readFileSync(join(root, "lib/registry/registry.json"), "utf8")) as Registry;
  const divisions = new Map(registry.divisions.map((row) => [row.ocdId, row]));
  const bodies = new Map(registry.bodies.map((row) => [row.id, row]));
  const datasetValues = new Map(loadManifestContext(root).datasets.map((dataset) => [dataset.path, dataset.value]));
  const atPointer = (value: unknown, pointer: string): Record<string, unknown> => {
    for (const key of pointer.split("/").slice(1)) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  };
  const cases: ReaderComponentCase[] = [];
  const unsupported: { auditId: string; reason: string }[] = [];
  const bodyOutput = new Map<string, { subject: ModalSubject; markup: string; expected: string[]; counts: ReaderComponentCase["rowCounts"] }>();
  const add = (record: CensusRecord, component: string, selector: string, payload: unknown, identities: string[], markup: string, expected: string[], rowCounts: ReaderComponentCase["rowCounts"] = {}, forbidden: string[] = []) => cases.push({ auditId: record.auditId, component, componentSha256: sha256(readFileSync(join(root, component))), selector, actualCanonicalIdentities: identities, payloadSha256: sha256(JSON.stringify(payload)), markup, markupSha256: sha256(markup), expectedFragments: expected, forbiddenFragments: forbidden, rowCounts, failures: inspectReaderMarkup(markup, expected, forbidden, rowCounts) });
  function renderBody(id: string) {
    const cached = bodyOutput.get(id); if (cached) return cached;
    const body = bodies.get(id); if (!body) return null;
    const division = body.ocdId ? divisions.get(body.ocdId) : undefined;
    const covered: CoveredBody = { bodyId: body.id, ocdId: body.ocdId, name: body.name, divisionLabel: division?.label ?? "", divisionType: division?.divisionType ?? null, lsad: division?.lsad ?? null, bodyClass: body.bodyClass, coverageStatus: body.coverageStatus, homepageUrl: body.homepageUrl, agendaSourceRef: body.agendaSourceRef, lookedAt: body.coverageStatus !== "NOT_ATTEMPTED", tier: division?.tier ?? "local" };
    const subject = bodySubject(covered, canonicalMeetings);
    const definitions = [subject.bodyCard!.whatItDoes.classDefinition, subject.bodyCard!.whatItDoes.formDefinition].filter((definition): definition is BodyDefinitionText => definition !== null);
    const markup = renderProduct(createElement(Fragment, null, createElement(EntityModal, { subject, onClose: () => {} }), ...definitions.map((definition, index) => createElement(DefinitionBlock, { key: index, definition })), createElement(Representation, { holders: subject.representation, note: subject.representationNote, gaps: subject.rosterGaps }), createElement(CardSourcesList, { sources: subject.sources })));
    const expected = [subject.title, subject.subtitle, ...(subject.rosterGaps ?? []).flatMap((gap) => [gap.statement, gap.sourceUrl, gap.sourceOrg]), ...definitions.flatMap((definition) => [definition.text, definition.basis, definition.readOn, ...(definition.basisUrl ? [definition.basisUrl] : [])]), ...subject.representation.flatMap((holder) => [holder.name, readerOfficeTitle(holder.officeTitle), holder.provenance?.sourceOrg ?? "", ...(holder.sourceUrl ? [holder.sourceUrl] : [])])].filter(Boolean);
    const counts = { seatedMembers: { expected: subject.representation.length, actual: [...markup.matchAll(/class="account-modal-person /g)].length }, sourcedDefinitions: { expected: definitions.length, actual: [...markup.matchAll(/Powers defined in:/g)].length }, rosterGaps: { expected: subject.rosterGaps?.length ?? 0, actual: [...markup.matchAll(/data-roster-completeness-gap=/g)].length } };
    const output = { subject, markup, expected, counts }; bodyOutput.set(id, output); return output;
  }
  const districtTypes: Record<string, DistrictHit["type"]> = { cd: "congressional", sldu: "state-senate", sldl: "state-house", county: "county", place: "municipal", school_district: "school-unified" };
  for (const record of census.records) {
    if (record.eligibility.state !== "READER_ELIGIBLE") continue;
    const raw = atPointer(datasetValues.get(record.holdingPath), record.pointer);
    if (record.family === "registry" && record.unit === "divisions" && !raw.officeholderId) {
      const division = divisions.get(String(raw.ocdId));
      if (!division) { unsupported.push({ auditId: record.auditId, reason: "Canonical division absent from registry." }); continue; }
      let type = districtTypes[division.divisionType];
      if (division.divisionType === "school_district") type = division.sourceDataset.includes("elsd") ? "school-elementary" : division.sourceDataset.includes("scsd") ? "school-secondary" : "school-unified";
      if (!type) { unsupported.push({ auditId: record.auditId, reason: `No actual map district type for ${division.divisionType}` }); continue; }
      const district: DistrictHit = { type, typeLabel: DISTRICT_LAYERS[type].label, tier: division.tier, ocdId: division.ocdId, label: division.label, state: division.state };
      const holders = await seatHoldersForDivision(division.ocdId);
      const markup = renderProduct(createElement(DistrictPopup, { district, representation: holders, upcomingMeetings: null }));
      const expected = [division.label, district.typeLabel, TIER_LABEL[division.tier], ...holders.flatMap((holder) => [holder.name, readerOfficeTitle(holder.officeTitle)])].filter(Boolean);
      const topCount = runsSomething(type) ? topOfficesFor(holders).length : 0;
      add(record, districtPath, "canonical registry division → seatHoldersForDivision → actual DistrictPopup", { district, holders }, [division.ocdId], markup, expected, { representationRows: { expected: holders.length + topCount, actual: [...markup.matchAll(/class="person-row"/g)].length } });
    } else if ((record.family === "registry" && record.unit === "bodies") || ["curated-body-identities", "body-compositions"].includes(record.family)) {
      const id = record.canonicalIdentity.find((identity) => bodies.has(identity));
      const output = id ? renderBody(id) : null;
      if (!output || !id) { unsupported.push({ auditId: record.auditId, reason: "Canonical body identity has no exact current registry row." }); continue; }
      add(record, entityPath, "exact map-entry bodySubject AST → actual EntityModal header and private DefinitionBlock/Representation leaves (collapsed children rendered independently)", output.subject, [id], output.markup, output.expected, output.counts);
    } else if (record.family === "sourced-definitions" && !record.holdingPath.endsWith("office-blurbs.ts")) {
      const definition = (raw.definition ?? raw) as Partial<BodyDefinitionText>;
      if (typeof definition.text !== "string") continue;
      // This fact must actually be selected for a held body before its leaf can
      // discharge a reader obligation. Template existence alone proves nothing.
      const consumer = registry.bodies.find((body) => { const output = renderBody(body.id)!; return [output.subject.bodyCard!.whatItDoes.classDefinition, output.subject.bodyCard!.whatItDoes.formDefinition].some((selected) => selected !== null && selected.text === definition.text && selected.basis === definition.basis); });
      if (!consumer) { unsupported.push({ auditId: record.auditId, reason: "No held body currently selects this sourced definition; template applicability requires explicit disposition." }); continue; }
      const output = renderBody(consumer.id)!;
      add(record, entityPath, "canonical definitionsForBody selected on exact current body → actual DefinitionBlock", output.subject.bodyCard!.whatItDoes, record.canonicalIdentity.filter((identity) => identity === consumer.id || identity === raw.formKey || identity === raw.classKey), output.markup, [definition.text, definition.basis ?? "", definition.readOn ?? ""].filter(Boolean));
    }
  }
  const sourcePaths = [selectorPath, entityPath, districtPath, "components/officials/card-sources-list.tsx", "lib/state/data.tsx", "lib/meetings/venues.ts", "lib/meetings/listing-identity.ts", "lib/ask/body-identity.ts", "data/meetings-snapshot.json", "lib/registry/registry.json", "lib/registry/body-membership.ts", "lib/registry/body-rosters.ts", "lib/officials/body-definitions.ts", "lib/officials/form-definitions.ts", "lib/officials/body-form.ts"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), formatVersion: 1, holdingsDigest: census.holdingsDigest, executionLevel: "ACTUAL_PRODUCT_LEAF_SSR", rule: "Actual product selector AST and product component bodies under the real DataProvider with canonical snapshot meetings and listing identity. EntityModal default header plus actual private expanded-content leaves rendered independently; no claim about browser expansion, residence, geometry applicability or deployed availability. Separate in-situ witnesses required.", providerContext: { sourceListingCount: snapshot.meetings.length, listingIdentity, location: null, governing: null, zipPartial: null, atAddress: false }, selectorAstSha256: sha256(extracted), sourceHashes: sourcePaths.map((path) => ({ path, sha256: sha256(readFileSync(join(root, path))) })), cases, unsupported, failures: cases.flatMap((entry) => entry.failures.map((failure) => `${entry.auditId}: ${failure}`)) };
}
