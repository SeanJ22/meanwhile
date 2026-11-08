-- Identical source bytes can be reused by every publisher without reading their body.
CREATE INDEX source_copy_content ON source_copy(final_url,sha256,http_status);
