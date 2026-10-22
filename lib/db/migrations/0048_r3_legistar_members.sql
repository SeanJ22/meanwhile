CREATE INDEX fact_member_lookup ON fact (field) INCLUDE (entity_id, status) WHERE field LIKE 'member:%';
