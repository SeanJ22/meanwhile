-- phase: contract
-- The deployed workers read canonical rows. Remove retired instructions and pointers once.
-- The migration transaction restores the guard before commit; ordinary writers cannot delete.
ALTER TABLE cp_field_manual_entries DISABLE TRIGGER cp_field_manual_entries_no_rewrite;
--> statement-breakpoint
DELETE FROM cp_field_manual_entries WHERE id IN ('fm-46726d913a9a3adc8328ce1d', 'fm-1ded93f8737b6452eac13b87', 'fm-7fa3809c57f6fdfc46ea5451')
 OR value->>'source' IN ('docs/branch-manifest.md', 'docs/zip-playbook.md', 'docs/source-ladder.md')
 OR value #>> '{payload,path}' IN ('docs/branch-manifest.md', 'docs/zip-playbook.md', 'docs/source-ladder.md')
 OR value->>'url' IN ('docs/branch-manifest.md', 'docs/zip-playbook.md', 'docs/source-ladder.md')
 OR (value->>'kind' = 'PLAYBOOK' AND id NOT IN ('fm-1790c56bba94e6a7093453aa', 'fm-457805a3fe3c4e3d238dacbd', 'fm-4927812aba4a5fc7448b95e4', 'fm-83fc7a3af78cea52cf1c04ab', 'fm-995d551463c748fdf4ceba14', 'fm-220766cd29b8177fbe15c604', 'fm-3069eaa6952134d521f4d731', 'fm-75171d099c06579ae4b5b5ca', 'fm-ec625517830bd6399af01362', 'fm-cbac5137a233164ac8f66243')
 AND (value->>'role' IN ('SCOUT', 'DETECTIVE', 'PARSER', 'AUDITOR', 'ENGINEER', 'MEASURE_WRITER', 'MEASURE_CHECKER', 'ASK_READER', 'ASK_WRITER', 'ASK_FALLBACK', 'VALIDATOR') OR value #>> '{payload,translator}' = 'true'));
--> statement-breakpoint
ALTER TABLE cp_field_manual_entries ENABLE TRIGGER cp_field_manual_entries_no_rewrite;
