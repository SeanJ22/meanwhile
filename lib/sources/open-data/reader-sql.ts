/** Logical reader slices are selected before their state/chunk suffix is known. */
export const OPEN_DATA_READER_KEY_PREFIX="open-data-partition:";
/** Filter native arrays before expanding rows; encoded groups retain their original order. */
export const OPEN_DATA_READER_PAYLOAD=`(WITH selected AS MATERIALIZED (
  SELECT coalesce(array_agg(logical),'{}'::text[]) AS exact_keys,
    coalesce(array_agg(logical) FILTER (WHERE logical ~ '^(zip|cell):'),'{}'::text[]) AS location_keys,
    ('$[*] ? (@.id == $exact[*]' || coalesce(string_agg(' || @.id starts with ' || to_jsonb(logical||':state:')::text,'')
      FILTER (WHERE logical ~ '^(zip|cell):'),'') || ')')::jsonpath AS native_path
  FROM (SELECT substring(key FROM ${OPEN_DATA_READER_KEY_PREFIX.length+1}) AS logical
    FROM unnest($3::text[]) requested(key) WHERE starts_with(key,'${OPEN_DATA_READER_KEY_PREFIX}')) keys
) SELECT CASE
  WHEN p.record_class='CURATED_READER_RECORD' AND p.source_id IN ('epa-echo','socrata-discovery')
    AND p.scope=p.source_id||':national' AND header->>'kind'='open-data' AND header->>'sourceId'=p.source_id
  THEN CASE WHEN header ? 'partitions' THEN reader_payload_value(header-'partitions') ||
    CASE WHEN jsonb_typeof(header->'partitions')='array' THEN jsonb_build_object('partitions',
      coalesce((SELECT jsonb_agg(reader_payload_value(item) ORDER BY ordinal_index)
        FROM jsonb_path_query(header->'partitions',selected.native_path,
          jsonb_build_object('exact',to_jsonb(selected.exact_keys))) WITH ORDINALITY members(item,ordinal_index)), '[]'::jsonb))
    ELSE (WITH partition_node AS MATERIALIZED (
      SELECT reader_payload_node(header->'partitions') AS node
    ), array_order AS MATERIALIZED (
      SELECT node,coalesce((reader_payload_value(node->'order')#>>'{}')::jsonb,'null'::jsonb) AS positions FROM partition_node
    ), array_metadata AS MATERIALIZED (
      SELECT node,positions FROM array_order
      WHERE jsonb_array_length(CASE WHEN node->>'kind'='array' THEN positions ELSE 'null'::jsonb END)>=0
        AND jsonb_array_length(coalesce(node->'groups','null'::jsonb))>=0
    ), group_metadata AS MATERIALIZED (
      SELECT (group_index-1)::integer AS group_id,group_node,
        jsonb_array_length(reader_payload_node(group_node)) AS member_count
      FROM array_metadata
      CROSS JOIN LATERAL jsonb_array_elements(node->'groups') WITH ORDINALITY groups(group_node,group_index)
    ), order_counts AS MATERIALIZED (
      SELECT (group_id#>>'{}')::integer AS group_id,count(*) AS member_count
      FROM array_metadata CROSS JOIN LATERAL jsonb_array_elements(positions) original(group_id)
      GROUP BY (group_id#>>'{}')::integer
    ), valid_order AS (
      SELECT NOT EXISTS(SELECT 1 FROM group_metadata FULL JOIN order_counts USING(group_id)
        WHERE group_metadata.member_count IS DISTINCT FROM order_counts.member_count) AS valid
    ), chosen_groups AS MATERIALIZED (
      SELECT group_id,members.ordinal_index AS member_index,reader_payload_value(members.item) AS value
      FROM group_metadata CROSS JOIN LATERAL reader_payload_members(group_node) members
      CROSS JOIN LATERAL (SELECT reader_payload_node(item)->>'id' AS native_id OFFSET 0) native
      WHERE native.native_id=ANY(selected.exact_keys)
        OR split_part(native.native_id,':state:',1)=ANY(selected.location_keys)
    ), chosen_order AS (
      SELECT global_index,(group_id#>>'{}')::integer AS group_id,
        row_number() OVER (PARTITION BY group_id ORDER BY global_index) AS member_index
      FROM array_metadata CROSS JOIN LATERAL jsonb_array_elements(positions) WITH ORDINALITY original(group_id,global_index)
      WHERE (group_id#>>'{}')::integer IN (SELECT group_id FROM chosen_groups)
    ) SELECT CASE WHEN valid_order.valid THEN jsonb_build_object('partitions',coalesce((
      SELECT jsonb_agg(chosen_groups.value ORDER BY global_index)
      FROM chosen_groups JOIN chosen_order USING(group_id,member_index)), '[]'::jsonb)) ELSE NULL END FROM valid_order)
    END
    ELSE reader_place_payload(p.payload,$3::text[],NULL) END
  ELSE NULL END
  FROM LATERAL (SELECT reader_payload_node(p.payload) AS header
    WHERE p.record_class='CURATED_READER_RECORD' AND p.source_id IN ('epa-echo','socrata-discovery')
      AND p.scope=p.source_id||':national' OFFSET 0) decoded CROSS JOIN selected)`;
