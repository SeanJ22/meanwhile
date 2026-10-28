ALTER TABLE place_page ADD COLUMN build_fingerprint text;
--> statement-breakpoint
CREATE INDEX place_page_build_fingerprint ON place_page(build_fingerprint) WHERE build_fingerprint IS NOT NULL;
--> statement-breakpoint
-- Compact only the wire representation. These immutable functions save no data.
CREATE FUNCTION reader_place_build_shape(value jsonb, dictionary jsonb, key_sets jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE shaped jsonb; keys jsonb;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'string' THEN RETURN dictionary->(value#>>'{}');
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(reader_place_build_shape(item,dictionary,key_sets) ORDER BY ordinal),'[]'::jsonb) INTO shaped
        FROM jsonb_array_elements(value) WITH ORDINALITY AS items(item,ordinal);
      RETURN jsonb_build_object('a',shaped);
    WHEN 'object' THEN
      SELECT coalesce(jsonb_agg(key ORDER BY key),'[]'::jsonb),
        coalesce(jsonb_agg(reader_place_build_shape(item,dictionary,key_sets) ORDER BY key),'[]'::jsonb) INTO keys,shaped
        FROM jsonb_each(value) AS items(key,item);
      RETURN jsonb_build_array(key_sets->(keys::text)) || shaped;
    ELSE RETURN jsonb_build_object('v',value);
  END CASE;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reader_place_build_prefix(lhs text, rhs text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE low integer:=0; high integer:=least(length(lhs),length(rhs)); middle integer;
BEGIN
  WHILE low<high LOOP
    middle:=(low+high+1)/2;
    IF left(lhs,middle)=left(rhs,middle) THEN low:=middle; ELSE high:=middle-1; END IF;
  END LOOP;
  RETURN low;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reader_place_build_pack(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  WITH RECURSIVE nodes(value) AS (
    SELECT value UNION ALL
    SELECT child.value FROM nodes n CROSS JOIN LATERAL (
      SELECT item FROM jsonb_each(CASE WHEN jsonb_typeof(n.value)='object' THEN n.value ELSE '{}'::jsonb END) AS objects(key,item)
      UNION ALL
      SELECT item FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.value)='array' THEN n.value ELSE '[]'::jsonb END) AS arrays(item)
    ) child(value)
  ), key_strings AS (
    SELECT key FROM nodes,LATERAL jsonb_each(CASE WHEN jsonb_typeof(value)='object' THEN value ELSE '{}'::jsonb END)
  ), strings AS (
    SELECT value#>>'{}' AS value FROM nodes WHERE jsonb_typeof(value)='string' UNION SELECT key FROM key_strings
  ), dictionary AS (
    SELECT value,row_number() OVER(ORDER BY value)-1 AS index,reader_place_build_prefix(value,coalesce(lag(value) OVER(ORDER BY value),'')) AS prefix FROM strings
  ), key_shapes AS (
    SELECT DISTINCT (SELECT coalesce(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_each(n.value)) AS shape
      FROM nodes n WHERE jsonb_typeof(n.value)='object'
  ), key_dictionary AS (
    SELECT shape,row_number() OVER(ORDER BY shape::text)-1 AS index FROM key_shapes
  ), maps AS (
    SELECT coalesce(jsonb_object_agg(value,index),'{}'::jsonb) AS strings,
      coalesce((SELECT jsonb_object_agg(shape::text,index) FROM key_dictionary),'{}'::jsonb) AS keys
    FROM dictionary
  ) SELECT jsonb_build_array(
      coalesce((SELECT jsonb_agg(CASE WHEN octet_length(to_jsonb(value)::text)>256 AND NOT EXISTS(SELECT 1 FROM key_strings k WHERE k.key=d.value)
        THEN jsonb_build_object('text',encode(sha256(convert_to(to_jsonb(value)::text,'UTF8')),'hex')) WHEN prefix>8 THEN jsonb_build_array(prefix,substr(value,prefix+1)) ELSE to_jsonb(value) END ORDER BY index) FROM dictionary d),'[]'::jsonb),
      coalesce((SELECT jsonb_agg((SELECT coalesce(jsonb_agg(m.strings->key ORDER BY ordinal),'[]'::jsonb)
        FROM jsonb_array_elements_text(shape) WITH ORDINALITY AS keys(key,ordinal)) ORDER BY index) FROM key_dictionary),'[]'::jsonb),
      reader_place_build_shape($1,m.strings,m.keys)) FROM maps m;
$$;
