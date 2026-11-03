-- A slice keeps a fingerprint of what it was built from, so a rebuild can tell from the database's own fingerprint of those inputs that nothing has changed and read none of them.
ALTER TABLE place_slice ADD COLUMN inputs text;
