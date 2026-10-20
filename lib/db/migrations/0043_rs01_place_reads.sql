CREATE INDEX "civic_data_promotions_meeting_body_idx" ON "civic_data_promotions" (split_part("scope", ':', 4))
  WHERE "record_class" = 'MEETING' AND left("scope", 7) = 'source:' AND split_part("scope", ':', 3) = 'body';
