ALTER TABLE place_slice DROP CONSTRAINT place_slice_card_check;
--> statement-breakpoint
ALTER TABLE place_slice ADD CONSTRAINT place_slice_card_check CHECK (card IN ('governs','bodies','ballot','money','more','meetings','history','agenda'));
