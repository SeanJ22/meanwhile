/** Compare small publication/check fingerprints without reading a saved source or its facts. */
export const votingPageFingerprintSql = `SELECT h.promotion_key AS key,encode(sha256(convert_to(h.content_hash||coalesce((
  SELECT string_agg(jsonb_build_array(s.source_key,s.raw_hash,s.parser_version,s.checked_at,s.source_urls,s.jurisdiction_ids,s.source_raw_hash)::text,'|' ORDER BY s.source_key)
  FROM civic_data_source_checks s WHERE s.record_class=h.record_class AND s.scope=h.scope),''),'UTF8')),'hex') AS fingerprint
  FROM civic_data_rows h WHERE h.promotion_key=ANY($1::text[]) AND h.collection='rp01.header'`;
