CREATE INDEX civic_data_rows_unfiled_place ON civic_data_rows (promotion_key, collection, (value->>'ocdId')) WHERE coalesce(body_id,'')='';
