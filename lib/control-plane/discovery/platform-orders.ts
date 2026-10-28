import { expansionScopesOf } from "../expansion/scopes.ts";
import { parseDispatchTarget } from "../scheduler/dispatch-target.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { ownerPlatformGovernments } from "./platform-census-pass.ts";
import type { PlatformQuery, PlatformRegistrationPage } from "./platform-registration.ts";
import { readZipPlace } from "../../place-map/reader.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../../census-geography/publication.ts";

/** Read only current order fields and the last pause instruction, never the research log or Admin's full value. */
export async function readPlatformOrders(query: PlatformQuery) {
  const [config] = await query(`WITH config AS (SELECT value FROM cp_admin_config WHERE id='current')
    SELECT (SELECT value->'expansionScopes' FROM config) AS scopes,(SELECT value->'placeTargets' FROM config) AS places,
    (SELECT record->>'action' FROM cp_log_research_intents WHERE log_key='level-1' AND record->>'kind'='INTENT'
      AND record->>'action' IN ('PAUSE_RUNNER','RESUME_RUNNER') ORDER BY position DESC LIMIT 1) AS pause
    `, []);
  const scopes = expansionScopesOf({ expansionScopes: config?.scopes });
  if (scopes.malformed) throw new Error("The owner's platform priorities could not be read");
  const subjects = scopes.scopes.map(scope => `assignment:${scope.key}`);
  for (const scope of scopes.scopes) {
    const g = scope.geography;
    const state = g.stateAbbr.toLowerCase(), prefix = Object.values(FIPS_TO_STATE).find(value => value.postal.toLowerCase() === state)?.prefix;
    if (g.type === "state" && prefix) subjects.push(`ocd-division/country:us/${prefix}:${state}`);
    if (g.type === "county") subjects.push(`county:${state}:${g.geoid}`);
    if (!["state", "county"].includes(g.type)) subjects.push(`geography:${state}:${g.type}:${g.geoid}:${g.version}`);
  }
  const dispatches = await query(`SELECT record->>'intentId' AS id,record->>'note' AS note FROM cp_log_research_intents d
    WHERE log_key='level-1' AND record->>'kind'='INTENT' AND record->>'action'='DISPATCH'
      AND NOT EXISTS (SELECT 1 FROM cp_log_research_intents c WHERE c.log_key=d.log_key AND c.record->>'action'='CANCEL_DISPATCH'
        AND c.record->>'note'=d.record->>'intentId') ORDER BY position`, []);
  subjects.unshift(...dispatches.flatMap(dispatch => [`assignment:dispatch:${String(dispatch.id)}`, `dispatch:${String(dispatch.note ?? "")}`]));
  for (const target of (config?.places ?? []) as { key: string }[]) {
    if (/^st:[a-z]{2}$/.test(target.key)) {
      const state = target.key.slice(3), prefix = Object.values(FIPS_TO_STATE).find(value => value.postal.toLowerCase() === state)?.prefix;
      if (prefix) subjects.push(`ocd-division/country:us/${prefix}:${state}`);
    } else if (/^geo:[a-z]{2}\.[a-z_]+\.[0-9A-Za-z]{1,16}$/.test(target.key)) {
      const [state, kind, geoid] = target.key.slice(4).split(".");
      const type = ({ cd: "congressional_district", sldu: "state_leg_upper", sldl: "state_leg_lower", cousub: "county_subdivision" } as Record<string, string>)[kind] ?? kind;
      subjects.push(type === "county" ? `county:${state}:${geoid}` : `geography:${state}:${type}:${geoid}`);
    }
  }
  const leads = await query(`SELECT DISTINCT r->>'place' AS place FROM cp_lead_orders o,
    LATERAL jsonb_array_elements(o.value->'rows') r WHERE o.value->>'open'='true'
      AND r->>'state' IN ('QUEUED','WORKS','PAID') AND r->>'place' IS NOT NULL`, []);
  subjects.unshift(...leads.map(row => String(row.place)));
  return { paused: config?.pause === "PAUSE_RUNNER", subjects: [...new Set(subjects)] };
}

/** The owner's materialized subjects are paged one at a time; no national obligation or government list is downloaded. */
export async function* orderedPlatformGovernments(control: PlatformQuery, reader: PlatformQuery, subjects: readonly string[]): AsyncGenerator<PlatformRegistrationPage> {
  const seen = new Set<string>();
  const unique = async function* (pages: AsyncGenerator<PlatformRegistrationPage>) {
    for await (const page of pages) if (!seen.has(page.government.id)) { seen.add(page.government.id); yield page; }
  };
  for (const subject of subjects) {
    if (subject.startsWith("assignment:")) {
      let after = "";
      for (;;) {
        const rows = await control(`SELECT value->>'subjectId' AS subject FROM cp_obligations
          WHERE value->>'active'='true' AND value->>'subjectId'>$2 AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(coalesce(value->'assignments','[]'::jsonb)) a WHERE a->>'assignmentKey'=$1)
          GROUP BY value->>'subjectId' ORDER BY value->>'subjectId' LIMIT 1`, [subject.slice(11), after]);
        if (!rows.length) break;
        after = String(rows[0].subject);
        yield* unique(ownerPlatformGovernments(reader, [after]));
      }
    } else if (subject.startsWith("geography:")) {
      const [, state, type, geoid, ...plan] = subject.split(":");
      let after = "";
      for (;;) {
        const rows = type === "zcta" ? after ? [] : [{ zip: geoid }] : await reader(`SELECT DISTINCT o->>'zcta5' AS zip
          FROM civic_data_promotions p,LATERAL jsonb_array_elements(p.payload->'scopes') s,
            LATERAL jsonb_array_elements(s->'groupings') g,LATERAL jsonb_array_elements(g->'overlaps') o
          WHERE p.record_class=$1 AND p.scope=$2 AND s->>'type'=$3 AND g->>'geoid'=$4
            AND ($3='cbsa' OR lower(g->>'stateAbbr')=$5) AND o->>'zcta5'>$6
            AND ($7::text IS NULL OR s->>'version'=$7) ORDER BY zip LIMIT 1`,
        [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, type, geoid, state, after, plan.length ? plan.join(":") : null]);
        if (!rows.length) break; after = String(rows[0].zip);
        const place = await readZipPlace(after);
        if (place) yield* unique(ownerPlatformGovernments(reader, place.ids));
      }
    } else if (subject.startsWith("county:") || subject.startsWith("dispatch:")) {
      const county = /^county:([a-z]{2}):(\d{5})$/.exec(subject);
      const target = county ? null : parseDispatchTarget(subject.slice(9));
      if (target && !target.states.length && !target.terms.length) continue;
      let after = "";
      for (;;) {
        const rows = await reader(`SELECT g AS government,p.current_version_id AS "versionId",p.promoted_at AS "promotedAt",c.normalized_hash AS "readModelHash"
          FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id,
            LATERAL jsonb_array_elements(p.payload->'governments') g
          WHERE p.record_class='REGISTRATION' AND g->>'id'>$1
            AND ($2::text[]='{}'::text[] OR lower(g->>'state')=ANY($2::text[]))
            AND ($3::text IS NULL OR g->>'countyFips'=$3)
            AND ($4::text[]='{}'::text[] OR EXISTS (SELECT 1 FROM unnest($4::text[]) term WHERE lower(coalesce(g->>'jurisdictionId',g->>'id')||' '||(g->>'name')) LIKE '%'||term||'%'))
          ORDER BY g->>'id' LIMIT 1`, [after, county ? [county[1]] : target!.states, county?.[2] ?? null, target?.terms ?? []]);
        if (!rows.length) break;
        const page = rows[0] as unknown as PlatformRegistrationPage; after = page.government.id;
        if (!seen.has(after)) { seen.add(after); yield page; }
      }
    } else yield* unique(ownerPlatformGovernments(reader, [subject]));
  }
}
