CREATE OR REPLACE FUNCTION reader_resolve_id(any_id text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE matches text[]; exact_id text;
BEGIN
  SELECT id INTO exact_id FROM entity WHERE id=any_id;
  IF exact_id IS NOT NULL THEN RETURN exact_id; END IF;
  SELECT array_agg(DISTINCT id) INTO matches FROM (
    SELECT entity_id AS id FROM entity_external_id WHERE value=any_id
    UNION SELECT entity_id FROM entity_external_id WHERE scheme='fec'
      AND value=substring(any_id FROM '^fec:([HSP][0-9][A-Z]{2}[0-9]{5})$')
    UNION SELECT id FROM entity WHERE kind='meeting' AND id='meeting:'||any_id
    UNION SELECT id FROM entity WHERE kind='person'
      AND id='congress-api:'||substring(any_id FROM '^congress:([A-Z][0-9]{6})$')
  ) found;
  IF cardinality(matches)>1 THEN RAISE EXCEPTION 'Ambiguous reader entity id: %',any_id; END IF;
  RETURN matches[1];
END $$;
