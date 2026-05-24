CREATE INDEX IF NOT EXISTS idx_vector_documents_fts ON vector_documents USING GIN (search_vector);
