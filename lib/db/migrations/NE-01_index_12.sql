SELECT reader_index_projection(p.key,p.current_version_id,p.payload,reader_payload_value(reader_payload_node(c.candidate)->'temporal'),c.retrieved_at)
  FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE (hashtext(p.key)&15)=12;
