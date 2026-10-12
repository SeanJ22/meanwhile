/**
 * The read model: implement the Admin-facing `CensusGeographyLookup` over a
 * built dataset. `createLookup` is pure (dataset in, lookup out) so it can be
 * unit-tested without the network or a database; `reader.ts` wires it to the
 * promoted production pointer or the non-prod bootstrap.
 *
 * Fails closed and never renders unknown as zero: a type/version we did not
 * publish is NOT_YET_PUBLISHED; a geography or ZCTA we do not carry is
 * NOT_IN_COVERAGE; an empty overlap set is only ever returned as OK.
 */
import type {
  CensusGeographyLookup,
  DatasetManifest,
  GeographyKey,
  GeographyRef,
  GeographyType,
  GeographyVersion,
  GeographyVersionKey,
  GroupingEnumeration,
  GroupingZctaResult,
  LookupStatus,
  PostalZipReconciliation,
  UspsZip,
  Zcta5,
  ZctaGroupingsResult,
  ZctaMembership,
} from "./contract.ts";
import type { BuiltDataset, BuiltGrouping, BuiltScope } from "./dataset.ts";

const OK: LookupStatus = { kind: "OK" };
const scopeId = (type: GeographyType, version: GeographyVersionKey): string => `${type}|${version}`;

function toRef(scope: BuiltScope, g: BuiltGrouping): GeographyRef {
  return {
    type: scope.type,
    geoid: g.geoid,
    version: scope.version,
    ocdId: g.ocdId,
    label: g.label,
    stateFips: g.stateFips,
    stateAbbr: g.stateAbbr,
    ...(g.cbsaClass ? { cbsaClass: g.cbsaClass } : {}),
    memberStates: g.memberStates,
  };
}

/**
 * Build an in-memory lookup over `dataset`. `publishedVersion` is the pointer
 * id this dataset was served from (a promotion version id, or a bootstrap id).
 */
export function createLookup(dataset: BuiltDataset, publishedVersion: string): CensusGeographyLookup {
  const scopes = new Map<string, BuiltScope>();
  const groupings = new Map<string, BuiltGrouping>();
  const defaultVersionByType = new Map<GeographyType, GeographyVersionKey>();
  const versions: GeographyVersion[] = [];
  const reverse = new Map<Zcta5, ZctaMembership[]>();
  const zctaUniverse = new Set<Zcta5>(dataset.zctaUniverse);

  for (const scope of dataset.scopes) {
    scopes.set(scopeId(scope.type, scope.version), scope);
    versions.push(scope.versionMeta);
    if (!defaultVersionByType.has(scope.type)) defaultVersionByType.set(scope.type, scope.version);
    for (const g of scope.groupings) {
      groupings.set(`${scopeId(scope.type, scope.version)}|${g.geoid}`, g);
      const ref = toRef(scope, g);
      for (const o of g.overlaps) {
        let list = reverse.get(o.zcta5);
        if (list === undefined) {
          list = [];
          reverse.set(o.zcta5, list);
        }
        list.push({ geography: ref, whole: o.whole, fraction: o.fraction, fractionBasis: scope.fractionBasis });
      }
    }
  }

  const manifestValue: DatasetManifest = {
    publishedVersion,
    publishedAt: dataset.builtAt,
    scopes: dataset.scopes.map((s) => ({
      type: s.type,
      version: s.version,
      instanceCount: s.instanceCount,
      zctaEdgeCount: s.zctaEdgeCount,
    })),
    versions,
  };

  const resolveScope = (type: GeographyType, version?: GeographyVersionKey): BuiltScope | undefined => {
    const v = version ?? defaultVersionByType.get(type);
    return v === undefined ? undefined : scopes.get(scopeId(type, v));
  };

  return {
    async activePublishedVersion() {
      return publishedVersion;
    },

    async manifest() {
      return manifestValue;
    },

    async listVersions() {
      return versions;
    },

    async enumerateGroupings(type: GeographyType, version?: GeographyVersionKey): Promise<GroupingEnumeration> {
      const scope = resolveScope(type, version);
      if (scope === undefined) {
        return {
          publishedVersion,
          status: {
            kind: "NOT_YET_PUBLISHED",
            note: `No published ${type} scope${version ? ` at version ${version}` : ""} in dataset ${publishedVersion}.`,
          },
          type,
          version: emptyVersion(type, version),
          instances: [],
          count: 0,
        };
      }
      const instances = scope.groupings.map((g) => toRef(scope, g));
      return {
        publishedVersion,
        status: OK,
        type,
        version: scope.versionMeta,
        instances,
        count: instances.length,
      };
    },

    async zctasForGrouping(key: GeographyKey): Promise<GroupingZctaResult> {
      const scope = scopes.get(scopeId(key.type, key.version));
      if (scope === undefined) {
        return notYetPublished(key, publishedVersion);
      }
      const g = groupings.get(`${scopeId(key.type, key.version)}|${key.geoid}`);
      if (g === undefined) {
        return {
          publishedVersion,
          status: {
            kind: "NOT_IN_COVERAGE",
            note: `${key.type} ${key.geoid} is not a geography in published version ${key.version}.`,
          },
          geography: { ...key, ocdId: null, label: key.geoid, stateFips: key.geoid.slice(0, 2), stateAbbr: "??", memberStates: [] },
          overlaps: [],
          count: 0,
          version: scope.versionMeta,
        };
      }
      return {
        publishedVersion,
        status: OK,
        geography: toRef(scope, g),
        overlaps: g.overlaps.map((o) => ({
          zcta5: o.zcta5,
          whole: o.whole,
          fraction: o.fraction,
          fractionBasis: scope.fractionBasis,
        })),
        count: g.overlaps.length,
        version: scope.versionMeta,
      };
    },

    async groupingsForZcta(zcta5: Zcta5, version?: GeographyVersionKey): Promise<ZctaGroupingsResult> {
      if (!zctaUniverse.has(zcta5)) {
        return {
          publishedVersion,
          status: {
            kind: "NOT_IN_COVERAGE",
            note: `${zcta5} is not a Census ZCTA in the published coverage.`,
          },
          zcta5,
          memberships: [],
        };
      }
      let memberships = reverse.get(zcta5) ?? [];
      if (version !== undefined) memberships = memberships.filter((m) => m.geography.version === version);
      return { publishedVersion, status: OK, zcta5, memberships };
    },

    async reconcilePostalZips(zips: readonly UspsZip[]): Promise<readonly PostalZipReconciliation[]> {
      return zips.map((zip) => {
        const isZcta = zctaUniverse.has(zip);
        return {
          zip,
          isZcta,
          outsideCoverageReason: isZcta ? null : "not_a_census_zcta",
        };
      });
    },
  };
}

function emptyVersion(type: GeographyType, version?: GeographyVersionKey): GeographyVersion {
  return {
    key: version ?? `${type}:unpublished`,
    type,
    plan: "not yet published",
    zctaTabulation: "2020",
    effectiveFor: "not yet published",
    provenance: { sourceUrls: [], sourceDataset: "", sourceFiles: [], sourceChecksums: [], method: "", computedAt: "" },
  };
}

function notYetPublished(key: GeographyKey, publishedVersion: string): GroupingZctaResult {
  return {
    publishedVersion,
    status: {
      kind: "NOT_YET_PUBLISHED",
      note: `No published ${key.type} scope at version ${key.version} in dataset ${publishedVersion}.`,
    },
    geography: { ...key, ocdId: null, label: key.geoid, stateFips: key.geoid.slice(0, 2), stateAbbr: "??", memberStates: [] },
    overlaps: [],
    count: 0,
    version: emptyVersion(key.type, key.version),
  };
}

export function notYetPublishedLookup(publishedVersion: string): CensusGeographyLookup {
  const empty: BuiltDataset = {
    formatVersion: 1,
    builtAt: new Date(0).toISOString(),
    coverage: "no dataset available",
    scopes: [],
    zctaUniverse: [],
  };
  const base = createLookup(empty, publishedVersion);
  return base;
}
