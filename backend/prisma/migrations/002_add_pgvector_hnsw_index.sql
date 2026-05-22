-- =====================================================
-- pgvector 索引优化脚本
-- 执行时间：2026-05-22
-- =====================================================

-- 1. 确保 pgvector 扩展已启用
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 创建 HNSW 索引（向量相似度检索优化）
-- 注意：HNSW 索引构建较慢，但查询速度更快
-- 对于 4096 维向量，推荐参数：m=16, ef_construction=64

CREATE INDEX IF NOT EXISTS "vector_documents_embedding_hnsw_idx"
ON "vector_documents"
USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. 或者使用 IVFFlat 索引（适合数据量较小的情况）
-- CREATE INDEX IF NOT EXISTS "vector_documents_embedding_ivfflat_idx"
-- ON "vector_documents"
-- USING ivfflat ("embedding" vector_cosine_ops)
-- WITH (lists = 100);

-- 4. 分析表以更新统计信息
ANALYZE "vector_documents";

-- =====================================================
-- 索引维护脚本（定期执行）
-- =====================================================

-- 重新构建索引（可选，当数据量变化较大时）
-- REINDEX INDEX "vector_documents_embedding_hnsw_idx";

-- =====================================================
-- 回滚脚本
-- =====================================================
-- DROP INDEX IF EXISTS "vector_documents_embedding_hnsw_idx";
