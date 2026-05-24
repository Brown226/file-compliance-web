-- P0-1: PostgreSQL 原生全文检索
ALTER TABLE vector_documents ADD COLUMN IF NOT EXISTS search_vector tsvector;
UPDATE vector_documents SET search_vector = to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(clause_id, '') || ' ' || coalesce(content, '')) WHERE search_vector IS NULL;
CREATE INDEX IF NOT EXISTS idx_vector_documents_fts ON vector_documents USING GIN (search_vector);
